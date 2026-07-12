import type { FastifyInstance } from "fastify";
import { friendRequestSchema } from "@snezhok/contracts";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { blockUser, cancelRequest, listFriends, removeFriend, requestFriend, respondFriend, unblockUser } from "./service.js";

const idParams = z.object({ id: z.string().uuid() });
const respondSchema = z.object({ action: z.enum(["accept", "decline"]) });

export async function friendRoutes(app: FastifyInstance) {
  app.get("/friends", { preHandler: requireAuth }, async (request) => ({ friends: await listFriends(request.auth.id) }));
  app.post("/friends/requests", { preHandler: requireAuth }, async (request, reply) => reply.status(201).send({ entry: await requestFriend(request.auth.id, friendRequestSchema.parse(request.body).username) }));
  app.post("/friends/requests/:id/respond", { preHandler: requireAuth }, async (request) => {
    const { id } = idParams.parse(request.params);
    return { entry: await respondFriend(request.auth.id, id, respondSchema.parse(request.body).action) };
  });
  app.delete("/friends/requests/:id", { preHandler: requireAuth }, async (request) => { await cancelRequest(request.auth.id, idParams.parse(request.params).id); return { success: true }; });
  app.delete("/friends/:id", { preHandler: requireAuth }, async (request) => { await removeFriend(request.auth.id, idParams.parse(request.params).id); return { success: true }; });
  app.post("/friends/:id/block", { preHandler: requireAuth }, async (request) => { await blockUser(request.auth.id, idParams.parse(request.params).id); return { success: true }; });
  app.delete("/friends/:id/block", { preHandler: requireAuth }, async (request) => { await unblockUser(request.auth.id, idParams.parse(request.params).id); return { success: true }; });
}
