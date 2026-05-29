import { FastifyInstance } from "fastify";
import { getMessages } from "../services/messages.js";
import { requireAuth } from "../lib/middleware.js";

export async function messageRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/messages",
    { preHandler: [requireAuth] },
    async (request: any, reply) => {
      const before = request.query.before
        ? parseInt(request.query.before as string, 10)
        : undefined;
      const limit = request.query.limit
        ? parseInt(request.query.limit as string, 10)
        : 50;

      try {
        const msgs = await getMessages(before, limit);
        return { messages: msgs };
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );
}
