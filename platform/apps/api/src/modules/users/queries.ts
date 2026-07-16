import type { UserSummary } from "@snezhok/contracts";
import type { DbClient } from "../../db/pool.js";
import { pool } from "../../db/pool.js";

export interface PublicUserRow {
  id: string; username: string; display_name: string; avatar_attachment_id: string | null; avatar_url: string | null; avatar_color: string; bio: string; status_text: string; last_seen_at_ms: number; show_last_seen: boolean;
}

export const publicUserSelect = `u.id,u.username,u.display_name,u.avatar_attachment_id,
  CASE WHEN u.avatar_attachment_id IS NULL THEN NULL ELSE '/api/v1/files/'||u.avatar_attachment_id||
    coalesce('?variant='||(SELECT v.id::text FROM media_variants v WHERE v.attachment_id=u.avatar_attachment_id AND v.role='thumbnail' ORDER BY v.created_at DESC LIMIT 1),'') END AS avatar_url,
  u.avatar_color,u.bio,u.status_text,
  (extract(epoch from u.last_seen_at)*1000)::bigint::float8 AS last_seen_at_ms,
  coalesce((SELECT (us.settings->>'showLastSeen')::boolean FROM user_settings us WHERE us.user_id=u.id),true) AS show_last_seen`;

export function mapUser(row: PublicUserRow): UserSummary {
  return { id: row.id, username: row.username, displayName: row.display_name, avatarUrl: row.avatar_url, avatarColor: row.avatar_color,
    bio: row.bio, statusText: row.status_text, presence: "offline", lastSeenAt: row.show_last_seen ? Number(row.last_seen_at_ms) : 0 };
}

export async function findUser(userId: string, client: Pick<DbClient, "query"> = pool) {
  return (await client.query<PublicUserRow>(`SELECT ${publicUserSelect} FROM users u WHERE u.id=$1 AND u.deleted_at IS NULL`, [userId])).rows[0];
}
