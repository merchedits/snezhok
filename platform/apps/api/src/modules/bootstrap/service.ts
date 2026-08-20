import type { BootstrapPayload, ChannelCategory, ChannelSummary, ConversationSummary, MessagePreview, ServerSummary } from "@snezhok/contracts";
import type { DbClient } from "../../db/pool.js";
import { pool, readSnapshot } from "../../db/pool.js";
import { currentCursor } from "../realtime/events.js";
import { listFriends } from "../friends/service.js";
import { defaultSettings } from "../settings/defaults.js";
import { findUser, mapContactUser, mapUser, publicUserSelect, type PublicUserRow } from "../users/queries.js";
import { visibleChannelIdsForUser } from "../servers/permissions.js";
import { effectiveMemberPolicy } from "../admin/policy.js";

export async function bootstrap(userId: string): Promise<BootstrapPayload> {
  return readSnapshot(async (client) => {
    const me = await findUser(userId, client);
    if (!me) throw new Error("Authenticated user was not found");
    // One repeatable-read snapshot guarantees the cursor describes exactly the
    // durable state represented by the bootstrap payload.
    const policy = await effectiveMemberPolicy(userId, client);
    const conversations = await conversationSummaries(userId, client);
    const serverData = policy.capabilities.servers ? await serverSummaries(userId, client) : { servers: [], categories: [], channels: [] };
    const friends = await listFriends(userId, client);
    const settingsResult = await client.query<{ settings: typeof defaultSettings }>("SELECT settings FROM user_settings WHERE user_id=$1", [userId]);
    const isAdmin = (await client.query<{ is_admin: boolean }>("SELECT is_admin FROM users WHERE id=$1", [userId])).rows[0]?.is_admin ?? false;
    const eventCursor = await currentCursor(userId, client);
    const contacts = new Map(friends.filter((entry) => entry.relationship === "friend").map((entry) => [entry.user.id, entry.user]));
    const privateConversations = conversations.map((conversation) => ({
      ...conversation,
      participants: conversation.participants.map((participant) => participant.id === userId ? mapContactUser(me) : contacts.get(participant.id) ?? participant),
    }));
    return {
      me: { ...mapContactUser(me), isAdmin }, conversations: privateConversations, servers: serverData.servers, categories: serverData.categories,
      channels: serverData.channels, friends, settings: { ...defaultSettings, ...(settingsResult.rows[0]?.settings ?? {}) }, eventCursor,
      capabilities: policy.capabilities,
    };
  });
}

export async function conversationSummary(userId: string, conversationId: string, client: Pick<DbClient, "query"> = pool): Promise<ConversationSummary> {
  const summary = (await loadConversationSummaries(userId, client, [conversationId]))[0];
  if (!summary) throw new Error("Conversation not found");
  return summary;
}

type ConversationBaseRow = {
  id: string;
  kind: "direct" | "group";
  title: string;
  avatar_attachment_id: string | null;
  saved: boolean;
  updated_at_ms: number;
  muted: boolean;
  pinned: boolean;
  archived: boolean;
};

type ConversationParticipantRow = PublicUserRow & { conversation_id: string; viewer_blocked: boolean };
type ConversationPreviewRow = {
  stream_id: string;
  id: string;
  sender_id: string;
  sender_name: string;
  text: string;
  kind: MessagePreview["kind"];
  created_at_ms: number;
  unread_count: number;
  mention_count: number;
};

export async function conversationSummaries(userId: string, client: Pick<DbClient, "query"> = pool): Promise<ConversationSummary[]> {
  return loadConversationSummaries(userId, client, null);
}

async function loadConversationSummaries(userId: string, client: Pick<DbClient, "query">, conversationIds: string[] | null): Promise<ConversationSummary[]> {
  // Keep recipient-specific membership, read-state, mute/pin/archive, and hidden
  // message predicates in SQL, but batch the three projections. Bootstrap now
  // performs a fixed three queries instead of 1 + (3 * conversation count).
  const baseRows = await client.query<ConversationBaseRow>(
    `SELECT c.id,c.kind,c.title,c.avatar_attachment_id,coalesce(c.saved_owner_id=$1,false) saved,
      (extract(epoch from c.updated_at)*1000)::bigint::float8 updated_at_ms,
      (cm.muted_until IS NOT NULL AND cm.muted_until>now()) muted,
      cm.pinned_at IS NOT NULL pinned,cm.archived_at IS NOT NULL archived
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id=c.id
     WHERE cm.user_id=$1 AND ($2::uuid[] IS NULL OR c.id=ANY($2::uuid[]))
     ORDER BY (c.saved_owner_id=$1) DESC,coalesce(cm.pinned_at,'epoch') DESC`,
    [userId, conversationIds],
  );
  if (!baseRows.rows.length) return [];

  const ids = baseRows.rows.map((row) => row.id);
  const participantRows = await client.query<ConversationParticipantRow>(
    `SELECT cm.conversation_id,${publicUserSelect},EXISTS(SELECT 1 FROM user_blocks b
       WHERE (b.blocker_id=$2 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$2)) viewer_blocked
     FROM conversation_members cm JOIN users u ON u.id=cm.user_id
     WHERE cm.conversation_id=ANY($1::uuid[])
     ORDER BY cm.conversation_id,u.display_name`,
    [ids, userId],
  );
  const previewRows = await client.query<ConversationPreviewRow>(
    `WITH visible_messages AS MATERIALIZED (
       SELECT m.* FROM messages m
       WHERE m.stream_kind='conversation' AND m.stream_id=ANY($1::uuid[]) AND m.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM hidden_messages hm WHERE hm.user_id=$2 AND hm.message_id=m.id)
     ), unread AS (
       SELECT m.stream_id,
         greatest(count(*) FILTER (WHERE m.sender_id<>$2 AND m.sequence>coalesce(rs.last_read_sequence,0)),
                  CASE WHEN max(rs.marked_unread_at_sequence) IS NULL THEN 0 ELSE 1 END)::int unread_count,
         count(*) FILTER (WHERE mm.user_id=$2 AND m.sequence>coalesce(rs.last_read_sequence,0))::int mention_count
       FROM visible_messages m
       LEFT JOIN read_states rs ON rs.user_id=$2 AND rs.stream_kind='conversation' AND rs.stream_id=m.stream_id
       LEFT JOIN message_mentions mm ON mm.message_id=m.id AND mm.user_id=$2
       GROUP BY m.stream_id
     )
     SELECT DISTINCT ON (m.stream_id) m.stream_id,m.id,m.sender_id,u.display_name sender_name,m.text,m.kind,
       (extract(epoch from m.created_at)*1000)::bigint::float8 created_at_ms,
       coalesce(unread.unread_count,0)::int unread_count,coalesce(unread.mention_count,0)::int mention_count
     FROM visible_messages m JOIN users u ON u.id=m.sender_id
     LEFT JOIN unread ON unread.stream_id=m.stream_id
     ORDER BY m.stream_id,m.sequence DESC`,
    [ids, userId],
  );

  const participantsByConversation = new Map<string, ReturnType<typeof mapUser>[]>();
  for (const row of participantRows.rows) {
    const participants = participantsByConversation.get(row.conversation_id) ?? [];
    const mapped = mapUser(row);
    participants.push(row.viewer_blocked ? { ...mapped, avatarUrl: null, bio: "", statusText: "", presence: "offline", lastSeenAt: 0 } : mapped);
    participantsByConversation.set(row.conversation_id, participants);
  }
  const previewByConversation = new Map(previewRows.rows.map((row) => [row.stream_id, mapPreview(row)]));
  const unreadByConversation = new Map(previewRows.rows.map((row) => [row.stream_id, row.unread_count]));
  const mentionsByConversation = new Map(previewRows.rows.map((row) => [row.stream_id, row.mention_count]));

  return baseRows.rows.map((base) => {
    const participants = participantsByConversation.get(base.id) ?? [];
    const other = participants.find((user) => user.id !== userId);
    return {
      id: base.id,
      kind: base.kind,
      title: base.saved ? "Saved Messages" : base.kind === "direct" ? (other?.displayName ?? "Direct message") : base.title,
      avatarUrl: base.kind === "direct" ? (other?.avatarUrl ?? null) : base.avatar_attachment_id ? `/api/v1/files/${base.avatar_attachment_id}` : null,
      participants,
      lastMessage: previewByConversation.get(base.id) ?? null,
      unreadCount: unreadByConversation.get(base.id) ?? 0,
      mentionCount: mentionsByConversation.get(base.id) ?? 0,
      muted: base.muted,
      pinned: base.pinned,
      archived: base.archived,
      saved: base.saved,
      updatedAt: Number(base.updated_at_ms),
    };
  });
}

async function serverSummaries(userId: string, client: DbClient) {
  const visibleChannelIds = await visibleChannelIdsForUser(userId, client);
  const serverRows = await client.query<{ id: string; name: string; owner_id: string; icon_attachment_id: string | null; position: number; mention_count: number; unread: boolean }>(
    `SELECT s.id,s.name,s.owner_id,s.icon_attachment_id,sm.position,
     (SELECT count(*)::int FROM channels ch JOIN messages m ON m.stream_kind='channel' AND m.stream_id=ch.id
       JOIN message_mentions mm ON mm.message_id=m.id AND mm.user_id=$1
       WHERE ch.server_id=s.id AND ch.id=ANY($2::uuid[]) AND m.deleted_at IS NULL
         AND m.sequence>coalesce((SELECT last_read_sequence FROM read_states WHERE user_id=$1 AND stream_kind='channel' AND stream_id=ch.id),0)
         AND NOT EXISTS (SELECT 1 FROM hidden_messages hm WHERE hm.user_id=$1 AND hm.message_id=m.id)) mention_count,
     EXISTS(
       SELECT 1 FROM channels ch JOIN messages m ON m.stream_kind='channel' AND m.stream_id=ch.id
       WHERE ch.server_id=s.id AND ch.id=ANY($2::uuid[]) AND m.deleted_at IS NULL AND m.sender_id<>$1
       AND m.sequence>coalesce((SELECT last_read_sequence FROM read_states WHERE user_id=$1 AND stream_kind='channel' AND stream_id=ch.id),0)
       AND NOT EXISTS (SELECT 1 FROM hidden_messages hm WHERE hm.user_id=$1 AND hm.message_id=m.id)
     ) OR EXISTS(SELECT 1 FROM channels ch JOIN read_states rs ON rs.stream_kind='channel' AND rs.stream_id=ch.id
       WHERE ch.server_id=s.id AND ch.id=ANY($2::uuid[]) AND rs.user_id=$1 AND rs.marked_unread_at_sequence IS NOT NULL) unread
     FROM servers s JOIN server_members sm ON sm.server_id=s.id WHERE sm.user_id=$1
       AND NOT EXISTS(SELECT 1 FROM server_bans ban WHERE ban.server_id=s.id AND ban.user_id=$1)
     ORDER BY sm.position,s.name`, [userId, visibleChannelIds]);
  const servers: ServerSummary[] = serverRows.rows.map((row) => ({ id: row.id, name: row.name, iconUrl: row.icon_attachment_id ? `/api/v1/files/${row.icon_attachment_id}` : null, ownerId: row.owner_id, unread: row.unread, mentionCount: row.mention_count, position: row.position }));
  const ids = servers.map((server) => server.id);
  if (!ids.length) return { servers, categories: [], channels: [] };
  const categoryRows = await client.query<{ id: string; server_id: string; name: string; position: number }>("SELECT id,server_id,name,position FROM channel_categories WHERE server_id=ANY($1::uuid[]) ORDER BY server_id,position", [ids]);
  const categories: ChannelCategory[] = categoryRows.rows.map((row) => ({ id: row.id, serverId: row.server_id, name: row.name, position: row.position, collapsed: false }));
  const channelRows = await client.query<{ id: string; server_id: string; category_id: string | null; kind: "text" | "voice"; name: string; topic: string; position: number; unread_count: number; mention_count: number }>(
    `SELECT ch.id,ch.server_id,ch.category_id,ch.kind,ch.name,ch.topic,ch.position,
      (SELECT count(*)::int FROM messages m WHERE m.stream_kind='channel' AND m.stream_id=ch.id AND m.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM hidden_messages hm WHERE hm.user_id=$1 AND hm.message_id=m.id)
       AND m.sender_id<>$1
       AND m.sequence>coalesce((SELECT last_read_sequence FROM read_states WHERE user_id=$1 AND stream_kind='channel' AND stream_id=ch.id),0))
       + CASE WHEN EXISTS(SELECT 1 FROM read_states rs WHERE rs.user_id=$1 AND rs.stream_kind='channel' AND rs.stream_id=ch.id AND rs.marked_unread_at_sequence IS NOT NULL)
              AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.stream_kind='channel' AND m.stream_id=ch.id AND m.deleted_at IS NULL AND m.sender_id<>$1
                AND m.sequence>coalesce((SELECT last_read_sequence FROM read_states WHERE user_id=$1 AND stream_kind='channel' AND stream_id=ch.id),0)) THEN 1 ELSE 0 END unread_count,
      (SELECT count(*)::int FROM messages m JOIN message_mentions mm ON mm.message_id=m.id AND mm.user_id=$1
       WHERE m.stream_kind='channel' AND m.stream_id=ch.id AND m.deleted_at IS NULL
         AND m.sequence>coalesce((SELECT last_read_sequence FROM read_states WHERE user_id=$1 AND stream_kind='channel' AND stream_id=ch.id),0)
         AND NOT EXISTS (SELECT 1 FROM hidden_messages hm WHERE hm.user_id=$1 AND hm.message_id=m.id)) mention_count
     FROM channels ch WHERE ch.server_id=ANY($2::uuid[]) AND ch.id=ANY($3::uuid[]) ORDER BY ch.server_id,ch.position`, [userId, ids, visibleChannelIds]);
  const channels: ChannelSummary[] = channelRows.rows.map((row) => ({ id: row.id, serverId: row.server_id, categoryId: row.category_id, kind: row.kind,
    name: row.name, topic: row.topic, position: row.position, unreadCount: row.unread_count, mentionCount: row.mention_count, connectedMembers: [] }));
  return { servers, categories, channels };
}

function mapPreview(row: { id: string; sender_id: string; sender_name: string; text: string; kind: MessagePreview["kind"]; created_at_ms: number }): MessagePreview {
  return { id: row.id, senderId: row.sender_id, senderName: row.sender_name, text: row.text, kind: row.kind, createdAt: Number(row.created_at_ms) };
}
