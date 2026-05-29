import { getMessages } from "../services/messages.js";
import { requireAuth } from "../lib/middleware.js";
import { checkUserAccessToConversation } from "../services/conversations.js";
export async function messageRoutes(fastify) {
    fastify.get("/api/messages", { preHandler: [requireAuth] }, async (request, reply) => {
        const conversationId = request.query.conversationId || "global";
        const before = request.query.before
            ? parseInt(request.query.before, 10)
            : undefined;
        const limit = request.query.limit
            ? parseInt(request.query.limit, 10)
            : 50;
        const userId = request.user.id;
        try {
            const hasAccess = await checkUserAccessToConversation(userId, conversationId);
            if (!hasAccess) {
                reply.status(403).send({ error: "You are not authorized to view this conversation." });
                return;
            }
            const msgs = await getMessages(conversationId, before, limit);
            return { messages: msgs };
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
}
