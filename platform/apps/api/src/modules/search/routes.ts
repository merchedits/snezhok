import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../auth/middleware.js";
import { getMessageById } from "../messages/service.js";
import { mapUser, publicUserSelect, type PublicUserRow } from "../users/queries.js";

const querySchema = z.object({ q: z.string().trim().min(1).max(128), streamId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });

export async function searchRoutes(app: FastifyInstance) {
  app.get("/search", { preHandler: requireAuth }, async (request) => {
    const query = querySchema.parse(request.query);
    const [users, messageIds, files] = await Promise.all([
      pool.query<PublicUserRow>(`SELECT ${publicUserSelect} FROM users u WHERE (u.username ILIKE $2 OR u.display_name ILIKE $2) AND u.id<>$1 ORDER BY u.display_name LIMIT $3`, [request.auth.id, `%${query.q}%`, query.limit]),
      pool.query<{ id: string }>(
        `SELECT m.id FROM messages m WHERE m.deleted_at IS NULL AND m.text ILIKE $2 AND ($3::uuid IS NULL OR m.stream_id=$3) AND (
           (m.stream_kind='conversation' AND EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=m.stream_id AND cm.user_id=$1)) OR
           (m.stream_kind='channel' AND EXISTS(SELECT 1 FROM channels ch JOIN server_members sm ON sm.server_id=ch.server_id WHERE ch.id=m.stream_id AND sm.user_id=$1))
         ) ORDER BY m.created_at DESC LIMIT $4`, [request.auth.id, `%${query.q}%`, query.streamId ?? null, query.limit]),
      pool.query<{ id: string; filename: string; kind: string; bytes: string }>(
        `SELECT DISTINCT a.id,a.filename,a.kind,a.bytes::text FROM attachments a LEFT JOIN message_attachments ma ON ma.attachment_id=a.id LEFT JOIN messages m ON m.id=ma.message_id
         WHERE a.filename ILIKE $2 AND (a.owner_id=$1 OR
           (m.stream_kind='conversation' AND EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=m.stream_id AND cm.user_id=$1)) OR
           (m.stream_kind='channel' AND EXISTS(SELECT 1 FROM channels ch JOIN server_members sm ON sm.server_id=ch.server_id WHERE ch.id=m.stream_id AND sm.user_id=$1)))
         ORDER BY a.filename LIMIT $3`, [request.auth.id, `%${query.q}%`, query.limit]),
    ]);
    const messages = await Promise.all(messageIds.rows.map((row) => getMessageById(pool, row.id, request.auth.id)));
    return { users: users.rows.map(mapUser), messages, files: files.rows.map((row) => ({ id: row.id, filename: row.filename, kind: row.kind, bytes: Number(row.bytes), url: `/api/v1/files/${row.id}` })) };
  });
}
