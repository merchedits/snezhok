import type { Message, MessageKind } from "@snezhok/contracts";
import type { DbClient } from "../../db/pool.js";
import { pool, transaction } from "../../db/pool.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { allocateMessageSequence, canManageMessages, resolveStreamAccess, streamRecipients } from "../streams/access.js";
import { publishStoredEvent, storeEvent } from "../realtime/events.js";

export interface MessageCreateInput {
  clientId: string;
  text: string;
  kind: Exclude<MessageKind, "system">;
  replyToId: string | null;
  attachmentIds: string[];
}

interface MessageRow {
  id: string; client_id: string | null; stream_id: string; stream_kind: "conversation" | "channel"; sequence: string;
  sender_id: string; kind: MessageKind; text: string; created_at_ms: number; edited_at_ms: number | null;
  deleted_at_ms: number | null; pinned_at_ms: number | null; username: string; display_name: string;
  avatar_attachment_id: string | null; avatar_color: string; bio: string; status_text: string; last_seen_at_ms: number;
  show_last_seen: boolean;
  reply_id: string | null; reply_sender_id: string | null; reply_sender_name: string | null;
  reply_text: string | null; reply_kind: MessageKind | null; reply_created_at_ms: number | null;
  forwarded_id: string | null; forwarded_sender_id: string | null; forwarded_sender_name: string | null;
  forwarded_text: string | null; forwarded_kind: MessageKind | null; forwarded_created_at_ms: number | null;
  attachments: unknown; reactions: unknown;
}

export async function createMessage(userId: string, streamId: string, input: MessageCreateInput) {
  const result = await transaction(async (client) => {
    const stream = await resolveStreamAccess(userId, streamId, client);
    if (stream.streamKind === "channel" && stream.channelKind !== "text") throw forbidden("Messages cannot be sent to a voice channel");

    const duplicate = await client.query<{ id: string; stream_kind: "conversation" | "channel"; stream_id: string }>("SELECT id,stream_kind,stream_id FROM messages WHERE sender_id=$1 AND client_id=$2", [userId, input.clientId]);
    if (duplicate.rows[0]) {
      if (duplicate.rows[0].stream_kind !== stream.streamKind || duplicate.rows[0].stream_id !== stream.streamId) throw conflict("Client message ID was already used in another stream");
      return { message: await getMessageById(client, duplicate.rows[0].id, userId), event: null };
    }

    if (input.replyToId) {
      const reply = await client.query("SELECT 1 FROM messages WHERE id=$1 AND stream_kind=$2 AND stream_id=$3", [input.replyToId, stream.streamKind, stream.streamId]);
      if (!reply.rowCount) throw conflict("Reply target is not in this stream");
    }
    if (input.attachmentIds.length) {
      const attachments = await client.query<{ id: string }>(
        "SELECT id FROM attachments WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND status IN ('ready','processing')",
        [input.attachmentIds, userId],
      );
      if (attachments.rowCount !== input.attachmentIds.length) throw forbidden("One or more attachments are unavailable");
      if (input.kind === "voice" || input.kind === "video-note") {
        const purpose = input.kind;
        await client.query("UPDATE upload_sessions SET media_purpose=$2,updated_at=now() WHERE id=ANY($1::uuid[]) AND owner_id=$3", [input.attachmentIds, purpose, userId]);
        for (const attachmentId of input.attachmentIds) {
          await client.query(
            `INSERT INTO media_jobs(id,attachment_id,profile)
             SELECT $1,a.id,us.quality FROM attachments a JOIN upload_sessions us ON us.id=a.id JOIN blobs b ON b.id=a.blob_id
             WHERE a.id=$2 AND a.owner_id=$3 AND (($4='voice' AND (b.detected_mime_type LIKE 'audio/%' OR b.detected_mime_type LIKE 'video/%')) OR ($4='video-note' AND b.detected_mime_type LIKE 'video/%'))
             ON CONFLICT(attachment_id,profile) DO NOTHING`,
            [newId(), attachmentId, userId, purpose],
          );
        }
      }
    }

    const id = newId();
    const sequence = await allocateMessageSequence(stream, client);
    await client.query(
      `INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text,reply_to_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, stream.streamKind, stream.streamId, sequence, userId, input.clientId, input.kind, input.text, input.replyToId],
    );
    for (const [position, attachmentId] of input.attachmentIds.entries()) {
      await client.query("INSERT INTO message_attachments(message_id,attachment_id,position) VALUES ($1,$2,$3)", [id, attachmentId, position]);
    }
    const message = await getMessageById(client, id, userId);
    const recipients = await streamRecipients(stream, client);
    const event = await storeEvent(client, recipients, "message:created", (recipientId: string) => personalizeMessage(message, recipientId));
    return { message, event };
  });
  if (result.event) publishStoredEvent(result.event);
  return result.message;
}

export async function forwardMessage(userId: string, messageId: string, targetStreamId: string, clientId: string) {
  const result = await transaction(async (client) => {
    const source = (await client.query<{
      id: string; stream_id: string; stream_kind: "conversation" | "channel"; kind: MessageKind; text: string; deleted_at: Date | null;
    }>("SELECT id,stream_id,stream_kind,kind,text,deleted_at FROM messages WHERE id=$1", [messageId])).rows[0];
    if (!source || source.deleted_at) throw notFound("Message not found");
    const sourceAccess = await resolveStreamAccess(userId, source.stream_id, client);
    if (sourceAccess.streamKind !== source.stream_kind) throw forbidden();

    const target = await resolveStreamAccess(userId, targetStreamId, client);
    if (target.streamKind === "channel" && target.channelKind !== "text") throw forbidden("Messages cannot be forwarded to a voice channel");
    const duplicate = await client.query<{ id: string; stream_kind: "conversation" | "channel"; stream_id: string }>(
      "SELECT id,stream_kind,stream_id FROM messages WHERE sender_id=$1 AND client_id=$2",
      [userId, clientId],
    );
    if (duplicate.rows[0]) {
      if (duplicate.rows[0].stream_kind !== target.streamKind || duplicate.rows[0].stream_id !== target.streamId) throw conflict("Client message ID was already used in another stream");
      return { message: await getMessageById(client, duplicate.rows[0].id, userId), event: null };
    }

    const id = newId();
    const sequence = await allocateMessageSequence(target, client);
    const kind = source.kind === "system" ? "text" : source.kind;
    await client.query(
      `INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text,forwarded_from_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, target.streamKind, target.streamId, sequence, userId, clientId, kind, source.text, source.id],
    );
    await client.query(
      `INSERT INTO message_attachments(message_id,attachment_id,position)
       SELECT $1,attachment_id,position FROM message_attachments WHERE message_id=$2 ORDER BY position`,
      [id, source.id],
    );
    const message = await getMessageById(client, id, userId);
    const recipients = await streamRecipients(target, client);
    const event = await storeEvent(client, recipients, "message:created", (recipientId: string) => personalizeMessage(message, recipientId));
    return { message, event };
  });
  if (result.event) publishStoredEvent(result.event);
  return result.message;
}

export async function listMessages(userId: string, streamId: string, before: number | null, limit: number) {
  const stream = await resolveStreamAccess(userId, streamId);
  const result = await pool.query<MessageRow>(`${messageSelectSql}
    WHERE m.stream_kind=$1 AND m.stream_id=$2 AND ($3::bigint IS NULL OR m.sequence < $3)
      AND NOT EXISTS (SELECT 1 FROM hidden_messages hm WHERE hm.user_id=$5 AND hm.message_id=m.id)
    ORDER BY m.sequence DESC LIMIT $4`, [stream.streamKind, streamId, before, limit, userId]);
  const items = result.rows.map((row) => mapMessage(row, userId)).reverse();
  return { items, nextCursor: items.length === limit ? String(items[0]!.sequence) : null };
}

export async function listPinnedMessages(userId: string, streamId: string) {
  const stream = await resolveStreamAccess(userId, streamId);
  const result = await pool.query<MessageRow>(`${messageSelectSql}
    WHERE m.stream_kind=$1 AND m.stream_id=$2 AND m.pinned_at IS NOT NULL AND m.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM hidden_messages hm WHERE hm.user_id=$3 AND hm.message_id=m.id)
    ORDER BY m.pinned_at DESC LIMIT 100`, [stream.streamKind, streamId, userId]);
  return result.rows.map((row) => mapMessage(row, userId));
}

export async function editMessage(userId: string, messageId: string, text: string) {
  return mutateMessage(userId, messageId, async (client, row) => {
    if (row.sender_id !== userId) throw forbidden("Only the author may edit this message");
    await client.query("UPDATE messages SET text=$2,edited_at=now() WHERE id=$1 AND deleted_at IS NULL", [messageId, text]);
    return "message:updated";
  });
}

export async function deleteMessage(userId: string, messageId: string) {
  return mutateMessage(userId, messageId, async (client, row, access) => {
    // Telegram-style private conversations allow either participant to remove
    // a message for both sides. Server channels keep their moderation boundary.
    if (access.streamKind === "channel" && row.sender_id !== userId && !canManageMessages(access.memberRole)) throw forbidden("You cannot delete this message");
    await client.query("UPDATE messages SET text='',deleted_at=now(),edited_at=NULL WHERE id=$1 AND deleted_at IS NULL", [messageId]);
    return "message:deleted";
  });
}

export async function hideMessage(userId: string, messageId: string) {
  return transaction(async (client) => {
    const row = (await client.query<{ stream_id: string; stream_kind: "conversation" | "channel" }>(
      "SELECT stream_id,stream_kind FROM messages WHERE id=$1",
      [messageId],
    )).rows[0];
    if (!row) throw notFound("Message not found");
    const access = await resolveStreamAccess(userId, row.stream_id, client);
    if (access.streamKind !== row.stream_kind) throw forbidden();
    await client.query(
      "INSERT INTO hidden_messages(user_id,message_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [userId, messageId],
    );
    return { id: messageId, streamId: row.stream_id };
  });
}

export async function setReaction(userId: string, messageId: string, emoji: string, active: boolean) {
  return mutateMessage(userId, messageId, async (client) => {
    if (active) await client.query("INSERT INTO message_reactions(message_id,user_id,emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [messageId, userId, emoji]);
    else await client.query("DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3", [messageId, userId, emoji]);
    return "message:updated";
  });
}

export async function setPinned(userId: string, messageId: string, pinned: boolean) {
  return mutateMessage(userId, messageId, async (client, _row, access) => {
    // Every participant can curate a private/direct conversation. Server
    // channels retain their moderation permission boundary.
    if (access.streamKind === "channel" && !canManageMessages(access.memberRole)) throw forbidden("You cannot pin messages in this stream");
    await client.query("UPDATE messages SET pinned_at=CASE WHEN $2 THEN now() ELSE NULL END,pinned_by=CASE WHEN $2 THEN $3::uuid ELSE NULL END WHERE id=$1", [messageId, pinned, userId]);
    return "message:updated";
  });
}

export async function markRead(userId: string, streamId: string, sequence: number) {
  const result = await transaction(async (client) => {
    const access = await resolveStreamAccess(userId, streamId, client);
    const maxSequence = access.streamKind === "conversation"
      ? Number((await client.query<{ value: string }>("SELECT (next_message_sequence-1)::text value FROM conversations WHERE id=$1", [streamId])).rows[0]?.value ?? 0)
      : Number((await client.query<{ value: string }>("SELECT (next_message_sequence-1)::text value FROM channels WHERE id=$1", [streamId])).rows[0]?.value ?? 0);
    const clampedSequence = clampReadSequence(sequence, maxSequence);
    await client.query(
      `INSERT INTO read_states(user_id,stream_kind,stream_id,last_read_sequence) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id,stream_kind,stream_id) DO UPDATE
       SET last_read_sequence=GREATEST(read_states.last_read_sequence,EXCLUDED.last_read_sequence),marked_unread_at_sequence=NULL,updated_at=now()`,
      [userId, access.streamKind, streamId, clampedSequence],
    );
    const privacy = await client.query<{ enabled: boolean }>("SELECT coalesce((settings->>'readReceipts')::boolean,true) enabled FROM user_settings WHERE user_id=$1", [userId]);
    const recipients = privacy.rows[0]?.enabled === false ? [userId] : await streamRecipients(access, client);
    const payload = { streamId, userId, sequence: clampedSequence };
    return { payload, event: await storeEvent(client, recipients, "read:updated", payload) };
  });
  publishStoredEvent(result.event);
  return result.payload;
}

async function mutateMessage(
  userId: string,
  messageId: string,
  mutation: (client: DbClient, row: { sender_id: string; stream_id: string; stream_kind: "conversation" | "channel" }, access: Awaited<ReturnType<typeof resolveStreamAccess>>) => Promise<string>,
) {
  const result = await transaction(async (client) => {
    const row = (await client.query<{ sender_id: string; stream_id: string; stream_kind: "conversation" | "channel" }>("SELECT sender_id,stream_id,stream_kind FROM messages WHERE id=$1 FOR UPDATE", [messageId])).rows[0];
    if (!row) throw notFound("Message not found");
    const access = await resolveStreamAccess(userId, row.stream_id, client);
    if (access.streamKind !== row.stream_kind) throw forbidden();
    const eventName = await mutation(client, row, access);
    const message = await getMessageById(client, messageId, userId);
    const streamRecipientIds = await streamRecipients(access, client);
    const hidden = await client.query<{ user_id: string }>(
      "SELECT user_id FROM hidden_messages WHERE message_id=$1 AND user_id=ANY($2::uuid[])",
      [messageId, streamRecipientIds],
    );
    const hiddenIds = new Set(hidden.rows.map((item) => item.user_id));
    const recipients = streamRecipientIds.filter((recipientId) => !hiddenIds.has(recipientId));
    const payload = eventName === "message:deleted"
      ? { id: message.id, streamId: message.streamId, deletedAt: message.deletedAt }
      : (recipientId: string) => personalizeMessage(message, recipientId);
    return { message, event: await storeEvent(client, recipients, eventName, payload) };
  });
  publishStoredEvent(result.event);
  return result.message;
}

export function personalizeMessage(message: Message, viewerId: string): Message {
  return { ...message, reactions: message.reactions.map((reaction) => ({ ...reaction, reacted: reaction.userIds.includes(viewerId) })) };
}
export function clampReadSequence(requested: number, maximum: number) { return Math.max(0, Math.min(requested, maximum)); }

export async function getMessageById(client: Pick<DbClient, "query">, id: string, viewerId?: string) {
  const row = (await client.query<MessageRow>(`${messageSelectSql} WHERE m.id=$1`, [id])).rows[0];
  if (!row) throw notFound("Message not found");
  return mapMessage(row, viewerId);
}

const messageSelectSql = `
  SELECT m.id,m.client_id,m.stream_id,m.stream_kind,m.sequence::text,m.sender_id,m.kind,m.text,
    (extract(epoch from m.created_at)*1000)::bigint::float8 AS created_at_ms,
    CASE WHEN m.edited_at IS NULL THEN NULL ELSE (extract(epoch from m.edited_at)*1000)::bigint::float8 END AS edited_at_ms,
    CASE WHEN m.deleted_at IS NULL THEN NULL ELSE (extract(epoch from m.deleted_at)*1000)::bigint::float8 END AS deleted_at_ms,
    CASE WHEN m.pinned_at IS NULL THEN NULL ELSE (extract(epoch from m.pinned_at)*1000)::bigint::float8 END AS pinned_at_ms,
    u.username,u.display_name,u.avatar_attachment_id,u.avatar_color,u.bio,u.status_text,(extract(epoch from u.last_seen_at)*1000)::bigint::float8 AS last_seen_at_ms,
    coalesce((SELECT (us.settings->>'showLastSeen')::boolean FROM user_settings us WHERE us.user_id=u.id),true) AS show_last_seen,
    reply.id AS reply_id,reply.sender_id AS reply_sender_id,ru.display_name AS reply_sender_name,reply.text AS reply_text,
    reply.kind AS reply_kind,CASE WHEN reply.created_at IS NULL THEN NULL ELSE (extract(epoch from reply.created_at)*1000)::bigint::float8 END AS reply_created_at_ms,
    forwarded.id AS forwarded_id,forwarded.sender_id AS forwarded_sender_id,fu.display_name AS forwarded_sender_name,forwarded.text AS forwarded_text,
    forwarded.kind AS forwarded_kind,CASE WHEN forwarded.created_at IS NULL THEN NULL ELSE (extract(epoch from forwarded.created_at)*1000)::bigint::float8 END AS forwarded_created_at_ms,
    COALESCE(att.items,'[]'::jsonb) AS attachments,COALESCE(react.items,'[]'::jsonb) AS reactions
  FROM messages m JOIN users u ON u.id=m.sender_id
  LEFT JOIN messages reply ON reply.id=m.reply_to_id LEFT JOIN users ru ON ru.id=reply.sender_id
  LEFT JOIN messages forwarded ON forwarded.id=m.forwarded_from_id LEFT JOIN users fu ON fu.id=forwarded.sender_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('id',a.id,'ownerId',a.owner_id,'kind',a.kind,'filename',a.filename,'mimeType',coalesce(p.mime_type,a.mime_type),
      'bytes',coalesce(p.bytes,a.bytes),'width',coalesce(p.width,a.width),'height',coalesce(p.height,a.height),'durationMs',coalesce(p.duration_ms,a.duration_ms),
      'quality',a.quality,'checksum',b.checksum_sha256,'primaryChecksum',p.checksum_sha256,'waveform',p.waveform,'originalUrl','/api/v1/files/'||a.id,
      'url',CASE WHEN p.id IS NULL THEN '/api/v1/files/'||a.id ELSE '/api/v1/files/'||a.id||'?variant='||p.id END,
      'thumbnailUrl',CASE WHEN t.id IS NOT NULL THEN '/api/v1/files/'||a.id||'?variant='||t.id WHEN a.thumbnail_attachment_id IS NOT NULL THEN '/api/v1/files/'||a.thumbnail_attachment_id ELSE NULL END) ORDER BY ma.position) items
    FROM message_attachments ma JOIN attachments a ON a.id=ma.attachment_id JOIN blobs b ON b.id=a.blob_id
    LEFT JOIN LATERAL (SELECT * FROM media_variants WHERE attachment_id=a.id AND role='primary' ORDER BY created_at DESC LIMIT 1) p ON true
    LEFT JOIN LATERAL (SELECT * FROM media_variants WHERE attachment_id=a.id AND role='thumbnail' ORDER BY created_at DESC LIMIT 1) t ON true
    WHERE ma.message_id=m.id
  ) att ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('emoji',x.emoji,'count',x.count,'reacted',false,'userIds',x.user_ids)) items FROM (
      SELECT emoji,count(*)::int count,jsonb_agg(user_id) user_ids FROM message_reactions WHERE message_id=m.id GROUP BY emoji
    ) x
  ) react ON true`;

function mapMessage(row: MessageRow, viewerId?: string): Message {
  const reactions = (row.reactions as Array<{ emoji: string; count: number; reacted: boolean; userIds: string[] }>).map((reaction) => ({ ...reaction, reacted: viewerId ? reaction.userIds.includes(viewerId) : false }));
  return {
    id: row.id, clientId: row.client_id, streamId: row.stream_id, streamKind: row.stream_kind, sequence: Number(row.sequence),
    sender: { id: row.sender_id, username: row.username, displayName: row.display_name, avatarUrl: row.avatar_attachment_id ? `/api/v1/files/${row.avatar_attachment_id}` : null, avatarColor: row.avatar_color,
      bio: row.bio, statusText: row.status_text, presence: "offline", lastSeenAt: row.show_last_seen ? Number(row.last_seen_at_ms) : 0 },
    kind: row.kind, text: row.text,
    replyTo: row.reply_id ? { id: row.reply_id, senderId: row.reply_sender_id!, senderName: row.reply_sender_name!, text: row.reply_text ?? "", kind: row.reply_kind!, createdAt: Number(row.reply_created_at_ms) } : null,
    forwardedFrom: row.forwarded_id ? { id: row.forwarded_id, senderId: row.forwarded_sender_id!, senderName: row.forwarded_sender_name!, text: row.forwarded_text ?? "", kind: row.forwarded_kind!, createdAt: Number(row.forwarded_created_at_ms) } : null,
    attachments: row.attachments as Message["attachments"], reactions,
    createdAt: Number(row.created_at_ms), editedAt: row.edited_at_ms === null ? null : Number(row.edited_at_ms),
    deletedAt: row.deleted_at_ms === null ? null : Number(row.deleted_at_ms), pinnedAt: row.pinned_at_ms === null ? null : Number(row.pinned_at_ms),
  };
}
