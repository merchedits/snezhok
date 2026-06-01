import { FastifyInstance } from "fastify";
import { createGroupConversation, getOrCreateDM, getUserConversations } from "../services/conversations.js";
import { requireAuth } from "../lib/middleware.js";

export async function conversationRoutes(fastify: FastifyInstance) {
  // Get active conversations list
  fastify.get(
    "/api/conversations",
    { preHandler: [requireAuth] },
    async (request: any, reply) => {
      try {
        const userId = request.user.id;
        const list = await getUserConversations(userId);
        return { conversations: list };
      } catch (err: any) {
        reply.status(500).send({ error: err.message });
      }
    }
  );

  // Start or get a private DM conversation with a user
  fastify.post(
    "/api/conversations/dm",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["targetUserId"],
          properties: {
            targetUserId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request: any, reply) => {
      const { targetUserId } = request.body || {};
      if (!targetUserId) {
        reply.status(400).send({ error: "targetUserId is required." });
        return;
      }

      try {
        const userId = request.user.id;
        const conversationId = await getOrCreateDM(userId, targetUserId);
        return { conversationId };
      } catch (err: any) {
        reply.status(500).send({ error: err.message });
      }
    }
  );

  fastify.post(
    "/api/conversations/group",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["memberIds"],
          properties: {
            memberIds: {
              type: "array",
              minItems: 2,
              items: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
    async (request: any, reply) => {
      const { memberIds } = request.body || {};
      try {
        const conversationId = await createGroupConversation(request.user.id, memberIds || []);
        return { conversationId };
      } catch (err: any) {
        reply.status(400).send({ error: err.message });
      }
    }
  );
}
