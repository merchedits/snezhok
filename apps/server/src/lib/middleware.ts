import { FastifyRequest, FastifyReply } from "fastify";
import { validateSession } from "../services/auth.js";

// Extend Fastify types
declare module "fastify" {
  interface FastifyRequest {
    user?: {
      id: string;
      username: string;
      displayName: string;
      avatarColor: string;
      isAdmin: boolean;
    };
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const sessionId = request.cookies.sessionId;

  if (!sessionId) {
    reply.status(401).send({ error: "Unauthorized. Session cookie missing." });
    return;
  }

  const user = await validateSession(sessionId);
  if (!user) {
    // Clear invalid session cookie
    reply.clearCookie("sessionId", { path: "/" });
    reply.status(401).send({ error: "Unauthorized. Session invalid or expired." });
    return;
  }

  request.user = user;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (!request.user?.isAdmin) {
    reply.status(403).send({ error: "Forbidden. Admin privileges required." });
  }
}
