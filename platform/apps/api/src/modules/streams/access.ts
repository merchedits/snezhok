import type { ServerPermission } from "@snezhok/contracts";
import type { DbClient } from "../../db/pool.js";
import { pool } from "../../db/pool.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { channelAuthorization } from "../servers/permissions.js";

export type StreamKind = "conversation" | "channel";

export interface StreamAccess {
  streamId: string;
  streamKind: StreamKind;
  memberRole: "owner" | "admin" | "moderator" | "member";
  serverId: string | null;
  channelKind: "text" | "voice" | null;
  serverPermissions: ServerPermission[];
}

export async function resolveStreamAccess(userId: string, streamId: string, client: Pick<DbClient, "query"> = pool) {
  const result = await client.query<StreamAccess>(
    `SELECT c.id AS "streamId", 'conversation' AS "streamKind", cm.role AS "memberRole",
            NULL::uuid AS "serverId", NULL::text AS "channelKind",'{}'::text[] AS "serverPermissions"
     FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id
     WHERE c.id=$1 AND cm.user_id=$2
     UNION ALL
     SELECT ch.id, 'channel', sm.role, ch.server_id, ch.kind,'{}'::text[]
     FROM channels ch JOIN server_members sm ON sm.server_id=ch.server_id
     WHERE ch.id=$1 AND sm.user_id=$2
     LIMIT 1`,
    [streamId, userId],
  );
  const access = result.rows[0];
  if (!access) throw forbidden("You do not have access to this stream");
  if (access.streamKind === "channel") {
    const authorization = await channelAuthorization(access.streamId, userId, client);
    if (!authorization.permissions.has("view_channels")) throw forbidden("You do not have access to this channel");
    access.serverPermissions = [...authorization.permissions];
  }
  return access;
}

export async function streamRecipients(stream: Pick<StreamAccess, "streamKind" | "streamId" | "serverId">, client: Pick<DbClient, "query">) {
  if (stream.streamKind === "conversation") {
    const result = await client.query<{ user_id: string }>("SELECT user_id FROM conversation_members WHERE conversation_id=$1", [stream.streamId]);
    return result.rows.map((row) => row.user_id);
  }
  const result = await client.query<{ user_id: string }>(
    `SELECT member.user_id FROM server_members member
     WHERE member.server_id=$1 AND NOT EXISTS(
       SELECT 1 FROM server_bans ban WHERE ban.server_id=member.server_id AND ban.user_id=member.user_id
     )`,
    [stream.serverId],
  );
  const visible = await Promise.all(result.rows.map(async (row) => {
    try {
      const authorization = await channelAuthorization(stream.streamId, row.user_id, client);
      return authorization.permissions.has("view_channels") ? row.user_id : null;
    } catch {
      return null;
    }
  }));
  return visible.filter((userId): userId is string => userId !== null);
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

export function canManageMessages(access: Pick<StreamAccess, "streamKind" | "memberRole" | "serverPermissions">) {
  return access.streamKind === "conversation"
    ? access.memberRole === "owner" || access.memberRole === "admin"
    : access.serverPermissions.includes("manage_messages");
}
