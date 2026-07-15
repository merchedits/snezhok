import type { FastifyInstance } from "fastify";
import { conversationCreateSchema } from "@snezhok/contracts";
import { z } from "zod";
import { pool, transaction } from "../../db/pool.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { requireAuth } from "../auth/middleware.js";
import { conversationSummary } from "../bootstrap/service.js";
import { publishStoredEvent, storeEvent } from "../realtime/events.js";

const params = z.object({ id: z.string().uuid() });
const patchSchema = z.object({ title: z.string().trim().min(1).max(80) });
const preferencesSchema = z.object({
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  muted: z.boolean().optional(),
}).refine((value) => value.pinned !== undefined || value.archived !== undefined || value.muted !== undefined, { message: "At least one preference is required" });

export async function conversationRoutes(app: FastifyInstance) {
  app.post("/conversations", { preHandler: requireAuth }, async (request, reply) => {
    const body = conversationCreateSchema.parse(request.body);
    const participantIds = [...new Set([request.auth.id, ...body.participantIds])].sort();
    const kind = participantIds.length <= 2 ? "direct" : "group";
    const creation = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dm:${participantIds.join(":")}`]);
      const users = await client.query<{ id: string }>("SELECT id FROM users WHERE id=ANY($1::uuid[])", [participantIds]);
      if (users.rowCount !== participantIds.length) throw notFound("One or more participants do not exist");
      if (kind === "direct") {
        const existing = await client.query<{ id: string }>(
        `SELECT c.id FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id
         WHERE c.kind='direct' GROUP BY c.id HAVING array_agg(cm.user_id ORDER BY cm.user_id)=$1::uuid[] LIMIT 1`, [participantIds]);
        if (existing.rows[0]) return { id: existing.rows[0].id, created: false, event: null };
      }
      const id = newId();
      await client.query("INSERT INTO conversations(id,kind,title,owner_id) VALUES ($1,$2,$3,$4)", [id, kind, body.title ?? "", request.auth.id]);
      for (const userId of participantIds) await client.query("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES ($1,$2,$3)", [id, userId, userId === request.auth.id ? "owner" : "member"]);
      const summaries = new Map<string, Awaited<ReturnType<typeof conversationSummary>>>();
      for (const participantId of participantIds) summaries.set(participantId, await conversationSummary(participantId, id, client));
      const event = await storeEvent(client, participantIds, "conversation:updated", (recipientId: string) => summaries.get(recipientId));
      return { id, created: true, event };
    });
    if (creation.event) publishStoredEvent(creation.event);
    const summary = await conversationSummary(request.auth.id, creation.id);
    return reply.status(creation.created ? 201 : 200).send({ conversation: summary });
  });
  app.patch("/conversations/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = params.parse(request.params); const { title } = patchSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const updated = await client.query("UPDATE conversations c SET title=$3,updated_at=now() FROM conversation_members cm WHERE c.id=$1 AND cm.conversation_id=c.id AND cm.user_id=$2 AND cm.role IN ('owner','admin') AND c.kind='group'", [id, request.auth.id, title]);
      if (!updated.rowCount) throw forbidden("You cannot rename this conversation");
      const participants = (await client.query<{ user_id: string }>("SELECT user_id FROM conversation_members WHERE conversation_id=$1", [id])).rows.map((row) => row.user_id);
      const summaries = new Map<string, Awaited<ReturnType<typeof conversationSummary>>>();
      for (const participantId of participants) summaries.set(participantId, await conversationSummary(participantId, id, client));
      const event = await storeEvent(client, participants, "conversation:updated", (recipient: string) => summaries.get(recipient));
      return { summary: summaries.get(request.auth.id)!, event };
    });
    publishStoredEvent(result.event); return { conversation: result.summary };
  });
  app.patch("/conversations/:id/preferences", { preHandler: requireAuth }, async (request) => {
    const { id } = params.parse(request.params);
    const body = preferencesSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const updated = await client.query(
        `UPDATE conversation_members cm SET
           pinned_at=CASE
             WHEN $3::boolean IS TRUE THEN now()
             WHEN $4::boolean IS TRUE OR $3::boolean IS FALSE THEN NULL
             ELSE pinned_at END,
           archived_at=CASE
             WHEN $4::boolean IS TRUE THEN now()
             WHEN $3::boolean IS TRUE OR $4::boolean IS FALSE THEN NULL
             ELSE archived_at END,
           muted_until=CASE
             WHEN $5::boolean IS TRUE THEN 'infinity'::timestamptz
             WHEN $5::boolean IS FALSE THEN NULL
             ELSE muted_until END
         FROM conversations c
         WHERE cm.conversation_id=$1 AND cm.user_id=$2 AND c.id=cm.conversation_id AND c.saved_owner_id IS NULL`,
        [id, request.auth.id, body.pinned ?? null, body.archived ?? null, body.muted ?? null],
      );
      if (!updated.rowCount) throw notFound("Conversation not found");
      const summary = await conversationSummary(request.auth.id, id, client);
      const event = await storeEvent(client, [request.auth.id], "conversation:updated", summary);
      return { summary, event };
    });
    publishStoredEvent(result.event);
    return { conversation: result.summary };
  });
  app.delete("/conversations/:id/members/me", { preHandler: requireAuth }, async (request) => {
    const { id } = params.parse(request.params);
    const event = await transaction(async (client) => {
      const result = await client.query(
        `DELETE FROM conversation_members cm USING conversations c
         WHERE cm.conversation_id=$1 AND cm.user_id=$2 AND c.id=cm.conversation_id AND c.saved_owner_id IS NULL`,
        [id, request.auth.id],
      );
      if (!result.rowCount) throw notFound("Conversation not found");
      return storeEvent(client, [request.auth.id], "conversation:removed", { id });
    });
    publishStoredEvent(event);
    return { success: true };
  });
}
