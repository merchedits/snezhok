import type { FastifyInstance } from "fastify";
import { markUnreadSchema, messageCreateSchema, messageEditSchema, reactionSchema } from "@snezhok/contracts";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { createMessage, deleteMessage, editMessage, forwardMessage, hideMessage, listMessageContext, listMessages, listPinnedMessages, markRead, markUnread, setPinned, setReaction } from "./service.js";

const streamParams = z.object({ streamId: z.string().uuid() });
const messageParams = z.object({ id: z.string().uuid() });
const historyQuery = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const readSchema = z.object({ sequence: z.number().int().nonnegative() });
const reactionBody = reactionSchema.extend({ active: z.boolean().default(true) });
const pinBody = z.object({ pinned: z.boolean() });
const forwardBody = z.object({ targetStreamId: z.string().uuid(), clientId: z.string().uuid() });
const reactionParams = z.object({ id: z.string().uuid(), emoji: z.string().min(1).max(32) });
const deleteQuery = z.object({ scope: z.enum(["me", "everyone"]).default("everyone") });

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
  app.post("/streams/:streamId/unread", { preHandler: requireAuth }, async (request) => {
    const { streamId } = streamParams.parse(request.params);
    return markUnread(request.auth.id, streamId, markUnreadSchema.parse(request.body ?? {}).sequence);
  });
  app.get("/streams/:streamId/pins", { preHandler: requireAuth }, async (request) => {
    const { streamId } = streamParams.parse(request.params);
    return { messages: await listPinnedMessages(request.auth.id, streamId) };
  });
  app.get("/messages/:id/context", { preHandler: requireAuth }, async (request) => {
    const { id } = messageParams.parse(request.params);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(60) }).parse(request.query);
    return listMessageContext(request.auth.id, id, limit);
  });
  app.patch("/messages/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = messageParams.parse(request.params);
    return { message: await editMessage(request.auth.id, id, messageEditSchema.parse(request.body).text) };
  });
  app.delete("/messages/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = messageParams.parse(request.params);
    if (deleteQuery.parse(request.query).scope === "me") return { hidden: await hideMessage(request.auth.id, id) };
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
  app.post("/messages/:id/forward", { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { id } = messageParams.parse(request.params);
    const body = forwardBody.parse(request.body);
    const message = await forwardMessage(request.auth.id, id, body.targetStreamId, body.clientId);
    return reply.status(201).send({ message });
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
