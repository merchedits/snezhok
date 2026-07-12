import type { DbClient } from "../../db/pool.js";
import { pool } from "../../db/pool.js";
import { forbidden, notFound } from "../../lib/errors.js";

export type StreamKind = "conversation" | "channel";

export interface StreamAccess {
  streamId: string;
  streamKind: StreamKind;
  memberRole: "owner" | "admin" | "moderator" | "member";
  serverId: string | null;
  channelKind: "text" | "voice" | null;
}

export async function resolveStreamAccess(userId: string, streamId: string, client: Pick<DbClient, "query"> = pool) {
  const result = await client.query<StreamAccess>(
    `SELECT c.id AS "streamId", 'conversation' AS "streamKind", cm.role AS "memberRole",
            NULL::uuid AS "serverId", NULL::text AS "channelKind"
     FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id
     WHERE c.id=$1 AND cm.user_id=$2
     UNION ALL
     SELECT ch.id, 'channel', sm.role, ch.server_id, ch.kind
     FROM channels ch JOIN server_members sm ON sm.server_id=ch.server_id
     WHERE ch.id=$1 AND sm.user_id=$2
     LIMIT 1`,
    [streamId, userId],
  );
  const access = result.rows[0];
  if (!access) throw forbidden("You do not have access to this stream");
  return access;
}

export async function streamRecipients(stream: Pick<StreamAccess, "streamKind" | "streamId" | "serverId">, client: Pick<DbClient, "query">) {
  const result = stream.streamKind === "conversation"
    ? await client.query<{ user_id: string }>("SELECT user_id FROM conversation_members WHERE conversation_id=$1", [stream.streamId])
    : await client.query<{ user_id: string }>("SELECT user_id FROM server_members WHERE server_id=$1", [stream.serverId]);
  return result.rows.map((row) => row.user_id);
}

export async function allocateMessageSequence(stream: Pick<StreamAccess, "streamKind" | "streamId">, client: DbClient) {
  const table = stream.streamKind === "conversation" ? "conversations" : "channels";
  const result = await client.query<{ sequence: string }>(
    `UPDATE ${table} SET next_message_sequence=next_message_sequence+1,updated_at=now()
     WHERE id=$1 RETURNING (next_message_sequence-1)::text AS sequence`,
    [stream.streamId],
  );
  if (!result.rows[0]) throw notFound("Stream not found");
  return Number(result.rows[0].sequence);
}

export function canManageMessages(role: StreamAccess["memberRole"]) {
  return role === "owner" || role === "admin" || role === "moderator";
}
