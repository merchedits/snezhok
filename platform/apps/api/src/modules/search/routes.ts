import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readSnapshot } from "../../db/pool.js";
import { requireAuth } from "../auth/middleware.js";
import { getMessageById } from "../messages/service.js";
import { visibleChannelIdsForUser } from "../servers/permissions.js";
import { mapUser, publicUserSelect, type PublicUserRow } from "../users/queries.js";

const querySchema = z.object({ q: z.string().trim().max(128).default(""), streamId: z.string().uuid().optional(), scope: z.enum(["all", "messages", "media", "files", "links"]).default("all"), limit: z.coerce.number().int().min(1).max(50).default(20) });
const mentionsQuerySchema = z.object({
  before: z.string().regex(/^\d{1,16}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export async function searchRoutes(app: FastifyInstance) {
  app.get("/search", { preHandler: requireAuth }, async (request) => {
    const query = querySchema.parse(request.query);
    return readSnapshot(async (client) => {
      const visibleChannelIds = await visibleChannelIdsForUser(request.auth.id, client);
      const [users, messageIds, files] = await Promise.all([
        client.query<PublicUserRow>(`SELECT ${publicUserSelect} FROM users u WHERE $2<>'' AND $4='all' AND u.deleted_at IS NULL
        AND (u.username ILIKE $3 OR u.display_name ILIKE $3) AND u.id<>$1
        AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$1))
        ORDER BY u.display_name LIMIT $5`, [request.auth.id, query.q, `%${query.q}%`, query.scope, query.limit]),
        client.query<{ id: string }>(
          `SELECT m.id FROM messages m WHERE m.deleted_at IS NULL AND ($2='' OR m.text ILIKE $3) AND ($4::uuid IS NULL OR m.stream_id=$4)
         AND NOT EXISTS (SELECT 1 FROM hidden_messages hm WHERE hm.user_id=$1 AND hm.message_id=m.id) AND (
           (m.stream_kind='conversation' AND EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=m.stream_id AND cm.user_id=$1)) OR
           (m.stream_kind='channel' AND m.stream_id=ANY($7::uuid[]))
         ) AND (
           $5 IN ('all','messages') OR
           ($5='links' AND m.text ~* 'https?://') OR
           ($5='media' AND EXISTS(SELECT 1 FROM message_attachments ma JOIN attachments a ON a.id=ma.attachment_id WHERE ma.message_id=m.id AND a.kind IN ('image','video'))) OR
           ($5='files' AND EXISTS(SELECT 1 FROM message_attachments ma JOIN attachments a ON a.id=ma.attachment_id WHERE ma.message_id=m.id AND a.kind IN ('audio','document')))
          ) ORDER BY m.created_at DESC LIMIT $6`, [request.auth.id, query.q, `%${query.q}%`, query.streamId ?? null, query.scope, query.limit, visibleChannelIds]),
        client.query<{ id: string; filename: string; kind: string; bytes: string }>(
          `SELECT DISTINCT a.id,a.filename,a.kind,a.bytes::text FROM attachments a LEFT JOIN message_attachments ma ON ma.attachment_id=a.id LEFT JOIN messages m ON m.id=ma.message_id
         WHERE ($2='' OR a.filename ILIKE $3) AND $4 IN ('all','media','files')
         AND ($4<>'media' OR a.kind IN ('image','video')) AND ($4<>'files' OR a.kind IN ('audio','document'))
         AND NOT EXISTS (SELECT 1 FROM hidden_messages hm WHERE hm.user_id=$1 AND hm.message_id=m.id) AND (a.owner_id=$1 OR
           (m.deleted_at IS NULL AND ((m.stream_kind='conversation' AND EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=m.stream_id AND cm.user_id=$1)) OR
           (m.stream_kind='channel' AND m.stream_id=ANY($6::uuid[])))))
         ORDER BY a.filename LIMIT $5`, [request.auth.id, query.q, `%${query.q}%`, query.scope, query.limit, visibleChannelIds]),
      ]);
      const messages = await Promise.all(messageIds.rows.map((row) => getMessageById(client, row.id, request.auth.id)));
      return { users: users.rows.map(mapUser), messages, files: files.rows.map((row) => ({ id: row.id, filename: row.filename, kind: row.kind, bytes: Number(row.bytes), url: `/api/v1/files/${row.id}` })) };
    });
  });

  app.get("/mentions", { preHandler: requireAuth }, async (request) => {
    const query = mentionsQuerySchema.parse(request.query);
    const cursor = query.before ? parseMentionCursor(query.before) : null;
    return readSnapshot(async (client) => {
      const visibleChannelIds = await visibleChannelIdsForUser(request.auth.id, client);
      const result = await client.query<{ id: string; created_at_us: string }>(
        `SELECT m.id,floor(extract(epoch from m.created_at)*1000000)::numeric::text created_at_us
       FROM message_mentions mm JOIN messages m ON m.id=mm.message_id
       WHERE mm.user_id=$1 AND m.deleted_at IS NULL
         AND ($2::numeric IS NULL OR (m.created_at,m.id)<(to_timestamp($2::numeric/1000000),$3::uuid))
         AND NOT EXISTS(SELECT 1 FROM hidden_messages hm WHERE hm.user_id=$1 AND hm.message_id=m.id)
         AND ((m.stream_kind='conversation' AND EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=m.stream_id AND cm.user_id=$1))
           OR (m.stream_kind='channel' AND m.stream_id=ANY($5::uuid[])))
       ORDER BY m.created_at DESC,m.id DESC LIMIT $4`,
        [request.auth.id, cursor?.atMicros ?? null, cursor?.id ?? null, query.limit, visibleChannelIds],
      );
      const items = await Promise.all(result.rows.map((row) => getMessageById(client, row.id, request.auth.id)));
      const last = result.rows.at(-1);
      return { items, nextCursor: last && result.rows.length === query.limit ? `${last.created_at_us}:${last.id}` : null };
    });
  });
}

export function parseMentionCursor(cursor: string) {
  const separator = cursor.indexOf(":");
  const atMicros = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  return { atMicros, id };
}
