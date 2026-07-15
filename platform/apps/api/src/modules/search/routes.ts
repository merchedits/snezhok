import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../auth/middleware.js";
import { getMessageById } from "../messages/service.js";
import { mapUser, publicUserSelect, type PublicUserRow } from "../users/queries.js";

const querySchema = z.object({ q: z.string().trim().max(128).default(""), streamId: z.string().uuid().optional(), scope: z.enum(["all", "messages", "media", "files", "links"]).default("all"), limit: z.coerce.number().int().min(1).max(50).default(20) });

export async function searchRoutes(app: FastifyInstance) {
  app.get("/search", { preHandler: requireAuth }, async (request) => {
    const query = querySchema.parse(request.query);
    const [users, messageIds, files] = await Promise.all([
      pool.query<PublicUserRow>(`SELECT ${publicUserSelect} FROM users u WHERE $2<>'' AND $4 IN ('all','messages') AND (u.username ILIKE $3 OR u.display_name ILIKE $3) AND u.id<>$1 ORDER BY u.display_name LIMIT $5`, [request.auth.id, query.q, `%${query.q}%`, query.scope, query.limit]),
      pool.query<{ id: string }>(
        `SELECT m.id FROM messages m WHERE m.deleted_at IS NULL AND ($2='' OR m.text ILIKE $3) AND ($4::uuid IS NULL OR m.stream_id=$4)
         AND NOT EXISTS (SELECT 1 FROM hidden_messages hm WHERE hm.user_id=$1 AND hm.message_id=m.id) AND (
           (m.stream_kind='conversation' AND EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=m.stream_id AND cm.user_id=$1)) OR
           (m.stream_kind='channel' AND EXISTS(SELECT 1 FROM channels ch JOIN server_members sm ON sm.server_id=ch.server_id WHERE ch.id=m.stream_id AND sm.user_id=$1))
         ) AND (
           $5 IN ('all','messages') OR
           ($5='links' AND m.text ~* 'https?://') OR
           ($5='media' AND EXISTS(SELECT 1 FROM message_attachments ma JOIN attachments a ON a.id=ma.attachment_id WHERE ma.message_id=m.id AND a.kind IN ('image','video'))) OR
           ($5='files' AND EXISTS(SELECT 1 FROM message_attachments ma JOIN attachments a ON a.id=ma.attachment_id WHERE ma.message_id=m.id AND a.kind IN ('audio','document')))
         ) ORDER BY m.created_at DESC LIMIT $6`, [request.auth.id, query.q, `%${query.q}%`, query.streamId ?? null, query.scope, query.limit]),
      pool.query<{ id: string; filename: string; kind: string; bytes: string }>(
        `SELECT DISTINCT a.id,a.filename,a.kind,a.bytes::text FROM attachments a LEFT JOIN message_attachments ma ON ma.attachment_id=a.id LEFT JOIN messages m ON m.id=ma.message_id
         WHERE ($2='' OR a.filename ILIKE $3) AND $4 IN ('all','media','files')
         AND ($4<>'media' OR a.kind IN ('image','video')) AND ($4<>'files' OR a.kind IN ('audio','document'))
         AND NOT EXISTS (SELECT 1 FROM hidden_messages hm WHERE hm.user_id=$1 AND hm.message_id=m.id) AND (a.owner_id=$1 OR
           (m.stream_kind='conversation' AND EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=m.stream_id AND cm.user_id=$1)) OR
           (m.stream_kind='channel' AND EXISTS(SELECT 1 FROM channels ch JOIN server_members sm ON sm.server_id=ch.server_id WHERE ch.id=m.stream_id AND sm.user_id=$1)))
         ORDER BY a.filename LIMIT $5`, [request.auth.id, query.q, `%${query.q}%`, query.scope, query.limit]),
    ]);
    const messages = await Promise.all(messageIds.rows.map((row) => getMessageById(pool, row.id, request.auth.id)));
    return { users: users.rows.map(mapUser), messages, files: files.rows.map((row) => ({ id: row.id, filename: row.filename, kind: row.kind, bytes: Number(row.bytes), url: `/api/v1/files/${row.id}` })) };
  });
}
