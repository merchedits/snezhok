import type { FastifyReply, FastifyRequest } from "fastify";
import { forbidden } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";

export async function requireGlobalAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  assertGlobalAdmin(request.auth);
}

export function assertGlobalAdmin(user: { isAdmin: boolean }) {
  if (!user.isAdmin) throw forbidden("Global administrator access is required");
}
