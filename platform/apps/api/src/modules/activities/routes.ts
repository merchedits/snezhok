import { cooperativeActivityCommandSchema, cooperativeActivityCreateSchema } from "@snezhok/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { commandActivity, createActivity, readActivity, readActivityHistory } from "./service.js";

const conversationParams = z.object({ conversationId: z.string().uuid() });
const activityParams = z.object({ id: z.string().uuid() });

export async function activityRoutes(app: FastifyInstance) {
  app.post("/conversations/:conversationId/activities", {
    preHandler: requireAuth,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const { conversationId } = conversationParams.parse(request.params);
    const message = await createActivity(request.auth.id, conversationId, cooperativeActivityCreateSchema.parse(request.body));
    return reply.status(201).send({ message });
  });

  app.get("/activities/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = activityParams.parse(request.params);
    return { activity: await readActivity(request.auth.id, id) };
  });

  app.get("/conversations/:conversationId/activities/history", { preHandler: requireAuth }, async (request) => {
    const { conversationId } = conversationParams.parse(request.params);
    return { messages: await readActivityHistory(request.auth.id, conversationId) };
  });

  app.post("/activities/:id/commands", {
    preHandler: requireAuth,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request) => {
    const { id } = activityParams.parse(request.params);
    const message = await commandActivity(request.auth.id, id, cooperativeActivityCommandSchema.parse(request.body));
    return { message };
  });
}
