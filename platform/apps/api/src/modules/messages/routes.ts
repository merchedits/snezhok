import type { FastifyInstance } from "fastify";
import { messageCreateSchema, messageEditSchema, reactionSchema } from "@snezhok/contracts";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { createMessage, deleteMessage, editMessage, listMessages, listPinnedMessages, markRead, setPinned, setReaction } from "./service.js";

const streamParams = z.object({ streamId: z.string().uuid() });
const messageParams = z.object({ id: z.string().uuid() });
const historyQuery = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const readSchema = z.object({ sequence: z.number().int().nonnegative() });
const reactionBody = reactionSchema.extend({ active: z.boolean().default(true) });
const pinBody = z.object({ pinned: z.boolean() });
const reactionParams = z.object({ id: z.string().uuid(), emoji: z.string().min(1).max(32) });

export async function messageRoutes(app: FastifyInstance) {
  app.get("/streams/:streamId/messages", { preHandler: requireAuth }, async (request) => {
    const { streamId } = streamParams.parse(request.params);
    const query = historyQuery.parse(request.query);
    return listMessages(request.auth.id, streamId, query.before ?? null, query.limit);
  });
  app.post("/streams/:streamId/messages", { preHandler: requireAuth }, async (request, reply) => {
    const { streamId } = streamParams.parse(request.params);
    const message = await createMessage(request.auth.id, streamId, messageCreateSchema.parse(request.body));
    return reply.status(201).send({ message });
  });
  app.post("/streams/:streamId/read", { preHandler: requireAuth }, async (request) => {
    const { streamId } = streamParams.parse(request.params);
    return markRead(request.auth.id, streamId, readSchema.parse(request.body).sequence);
  });
  app.get("/streams/:streamId/pins", { preHandler: requireAuth }, async (request) => {
    const { streamId } = streamParams.parse(request.params);
    return { messages: await listPinnedMessages(request.auth.id, streamId) };
  });
  app.patch("/messages/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = messageParams.parse(request.params);
    return { message: await editMessage(request.auth.id, id, messageEditSchema.parse(request.body).text) };
  });
  app.delete("/messages/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = messageParams.parse(request.params);
    return { message: await deleteMessage(request.auth.id, id) };
  });
  app.put("/messages/:id/reactions", { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
    const { id } = messageParams.parse(request.params);
    const body = reactionBody.parse(request.body);
    return { message: await setReaction(request.auth.id, id, body.emoji, body.active) };
  });
  app.post("/messages/:id/reactions", { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
    const { id } = messageParams.parse(request.params); const { emoji } = reactionSchema.parse(request.body);
    return { message: await setReaction(request.auth.id, id, emoji, true) };
  });
  app.delete("/messages/:id/reactions/:emoji", { preHandler: requireAuth }, async (request) => {
    const { id, emoji } = reactionParams.parse(request.params);
    return { message: await setReaction(request.auth.id, id, emoji, false) };
  });
  app.put("/messages/:id/pin", { preHandler: requireAuth }, async (request) => {
    const { id } = messageParams.parse(request.params);
    return { message: await setPinned(request.auth.id, id, pinBody.parse(request.body).pinned) };
  });
}
