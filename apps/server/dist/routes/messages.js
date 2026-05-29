import { getMessages } from "../services/messages.js";
import { requireAuth } from "../lib/middleware.js";
export async function messageRoutes(fastify) {
    fastify.get("/api/messages", { preHandler: [requireAuth] }, async (request, reply) => {
        const before = request.query.before
            ? parseInt(request.query.before, 10)
            : undefined;
        const limit = request.query.limit
            ? parseInt(request.query.limit, 10)
            : 50;
        try {
            const msgs = await getMessages(before, limit);
            return { messages: msgs };
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
}
