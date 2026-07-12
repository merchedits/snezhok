import type { FastifyReply, FastifyRequest } from "fastify";
import { authenticateAccessToken } from "./service.js";
import { unauthorized } from "../../lib/errors.js";

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : request.cookies.access_token;
  if (!token) throw unauthorized();
  request.auth = await authenticateAccessToken(token);
}

export function getBearerOrCookie(request: Pick<FastifyRequest, "headers" | "cookies">) {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : request.cookies.access_token;
}
