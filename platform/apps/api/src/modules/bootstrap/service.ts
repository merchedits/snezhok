import type { BootstrapPayload, ChannelCategory, ChannelSummary, ConversationSummary, MessagePreview, ServerSummary } from "@snezhok/contracts";
import type { DbClient } from "../../db/pool.js";
import { pool, readSnapshot } from "../../db/pool.js";
import { currentCursor } from "../realtime/events.js";
import { listFriends } from "../friends/service.js";
import { defaultSettings } from "../settings/defaults.js";
import { findUser, mapUser, publicUserSelect, type PublicUserRow } from "../users/queries.js";

export async function bootstrap(userId: string): Promise<BootstrapPayload> {
  return readSnapshot(async (client) => {
    const me = await findUser(userId, client);
    if (!me) throw new Error("Authenticated user was not found");
    // One repeatable-read snapshot guarantees the cursor describes exactly the
    // durable state represented by the bootstrap payload.
    const conversations = await conversationSummaries(userId, client);
    const serverData = await serverSummaries(userId, client);
    const friends = await listFriends(userId, client);
    const settingsResult = await client.query<{ settings: typeof defaultSettings }>("SELECT settings FROM user_settings WHERE user_id=$1", [userId]);
    const eventCursor = await currentCursor(userId, client);
    return {
      me: mapUser(me), conversations, servers: serverData.servers, categories: serverData.categories,
      channels: serverData.channels, friends, settings: { ...defaultSettings, ...(settingsResult.rows[0]?.settings ?? {}) }, eventCursor,
    };
  });
}

export async function conversationSummary(userId: string, conversationId: string, client: Pick<DbClient, "query"> = pool): Promise<ConversationSummary> {
  const base = (await client.query<{ id: string; kind: "direct" | "group"; title: string; updated_at_ms: number; muted: boolean; pinned: boolean; archived: boolean; unread_count: number }>(
    `SELECT c.id,c.kind,c.title,(extract(epoch from c.updated_at)*1000)::bigint::float8 updated_at_ms,
      (cm.muted_until IS NOT NULL AND cm.muted_until>now()) muted,cm.pinned_at IS NOT NULL pinned,cm.archived_at IS NOT NULL archived,
      (SELECT count(*)::int FROM messages m WHERE m.stream_kind='conversation' AND m.stream_id=c.id AND m.deleted_at IS NULL
       AND m.sequence > coalesce((SELECT last_read_sequence FROM read_states WHERE user_id=$1 AND stream_kind='conversation' AND stream_id=c.id),0)) unread_count
     FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.id=$2 AND cm.user_id=$1`, [userId, conversationId])).rows[0];
  if (!base) throw new Error("Conversation not found");
  const participantRows = await client.query<PublicUserRow>(`SELECT ${publicUserSelect} FROM conversation_members cm JOIN users u ON u.id=cm.user_id WHERE cm.conversation_id=$1 ORDER BY u.display_name`, [conversationId]);
  const participants = participantRows.rows.map(mapUser);
  const last = await client.query<{ id: string; sender_id: string; sender_name: string; text: string; kind: MessagePreview["kind"]; created_at_ms: number }>(
    `SELECT m.id,m.sender_id,u.display_name sender_name,m.text,m.kind,(extract(epoch from m.created_at)*1000)::bigint::float8 created_at_ms
     FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.stream_kind='conversation' AND m.stream_id=$1 ORDER BY m.sequence DESC LIMIT 1`, [conversationId]);
  const other = participants.find((user) => user.id !== userId);
  return { id: base.id, kind: base.kind, title: base.kind === "direct" ? (other?.displayName ?? "Saved Messages") : base.title,
    avatarUrl: base.kind === "direct" ? (other?.avatarUrl ?? null) : null, participants,
    lastMessage: last.rows[0] ? mapPreview(last.rows[0]) : null, unreadCount: base.unread_count, mentionCount: 0,
    muted: base.muted, pinned: base.pinned, archived: base.archived, updatedAt: Number(base.updated_at_ms) };
}

async function conversationSummaries(userId: string, client: DbClient) {
  const ids = await client.query<{ id: string }>("SELECT conversation_id id FROM conversation_members WHERE user_id=$1 ORDER BY coalesce(pinned_at,'epoch') DESC", [userId]);
  const summaries: ConversationSummary[] = [];
  for (const row of ids.rows) summaries.push(await conversationSummary(userId, row.id, client));
  return summaries;
}

async function serverSummaries(userId: string, client: DbClient) {
  const serverRows = await client.query<{ id: string; name: string; owner_id: string; position: number; mention_count: number; unread: boolean }>(
    `SELECT s.id,s.name,s.owner_id,sm.position,0::int mention_count,EXISTS(
       SELECT 1 FROM channels ch JOIN messages m ON m.stream_kind='channel' AND m.stream_id=ch.id
       WHERE ch.server_id=s.id AND m.sequence>coalesce((SELECT last_read_sequence FROM read_states WHERE user_id=$1 AND stream_kind='channel' AND stream_id=ch.id),0)
     ) unread FROM servers s JOIN server_members sm ON sm.server_id=s.id WHERE sm.user_id=$1 ORDER BY sm.position,s.name`, [userId]);
  const servers: ServerSummary[] = serverRows.rows.map((row) => ({ id: row.id, name: row.name, iconUrl: null, ownerId: row.owner_id, unread: row.unread, mentionCount: row.mention_count, position: row.position }));
  const ids = servers.map((server) => server.id);
  if (!ids.length) return { servers, categories: [], channels: [] };
  const categoryRows = await client.query<{ id: string; server_id: string; name: string; position: number }>("SELECT id,server_id,name,position FROM channel_categories WHERE server_id=ANY($1::uuid[]) ORDER BY server_id,position", [ids]);
  const categories: ChannelCategory[] = categoryRows.rows.map((row) => ({ id: row.id, serverId: row.server_id, name: row.name, position: row.position, collapsed: false }));
  const channelRows = await client.query<{ id: string; server_id: string; category_id: string | null; kind: "text" | "voice"; name: string; topic: string; position: number; unread_count: number }>(
    `SELECT ch.id,ch.server_id,ch.category_id,ch.kind,ch.name,ch.topic,ch.position,
      (SELECT count(*)::int FROM messages m WHERE m.stream_kind='channel' AND m.stream_id=ch.id AND m.deleted_at IS NULL
       AND m.sequence>coalesce((SELECT last_read_sequence FROM read_states WHERE user_id=$1 AND stream_kind='channel' AND stream_id=ch.id),0)) unread_count
     FROM channels ch WHERE ch.server_id=ANY($2::uuid[]) ORDER BY ch.server_id,ch.position`, [userId, ids]);
  const channels: ChannelSummary[] = channelRows.rows.map((row) => ({ id: row.id, serverId: row.server_id, categoryId: row.category_id, kind: row.kind,
    name: row.name, topic: row.topic, position: row.position, unreadCount: row.unread_count, mentionCount: 0, connectedMembers: [] }));
  return { servers, categories, channels };
}

function mapPreview(row: { id: string; sender_id: string; sender_name: string; text: string; kind: MessagePreview["kind"]; created_at_ms: number }): MessagePreview {
  return { id: row.id, senderId: row.sender_id, senderName: row.sender_name, text: row.text, kind: row.kind, createdAt: Number(row.created_at_ms) };
}
