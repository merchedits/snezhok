import { FastifyInstance } from "fastify";
import { getMessages } from "../services/messages.js";
import { requireAuth } from "../lib/middleware.js";
import { checkUserAccessToConversation } from "../services/conversations.js";

export async function messageRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/messages",
    { preHandler: [requireAuth] },
    async (request: any, reply) => {
      const conversationId = (request.query.conversationId as string) || "global";
      const before = request.query.before
        ? parseInt(request.query.before as string, 10)
        : undefined;
      const requestedLimit = request.query.limit
        ? parseInt(request.query.limit as string, 10)
        : 50;
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(requestedLimit, 100))
        : 50;

      const userId = request.user.id;

      try {
        if (before !== undefined && !Number.isFinite(before)) {
          reply.status(400).send({ error: "Invalid before timestamp." });
          return;
        }

        const hasAccess = await checkUserAccessToConversation(userId, conversationId);
        if (!hasAccess) {
          reply.status(403).send({ error: "You are not authorized to view this conversation." });
          return;
        }

        const msgs = await getMessages(conversationId, before, limit);
        return { messages: msgs };
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );
}
