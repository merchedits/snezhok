import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { loginSchema, registerSchema } from "@snezhok/contracts";
import { z } from "zod";
import { config } from "../../config.js";
import { login, refresh, register, revokeOtherSessions, revokeSession, listSessions } from "./service.js";
import { requireAuth } from "./middleware.js";

const refreshSchema = z.object({ refreshToken: z.string().min(16).optional() });
const sessionParams = z.object({ id: z.string().uuid() });

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const result = await register({ ...body, ...clientContext(request) });
    setSessionCookies(reply, result.accessToken, result.refreshToken);
    return clientSafeSession(result);
  });

  app.post("/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await login({ ...body, ...clientContext(request) });
    setSessionCookies(reply, result.accessToken, result.refreshToken);
    return clientSafeSession(result);
  });

  app.post("/auth/refresh", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = refreshSchema.parse(request.body ?? {});
    const token = body.refreshToken ?? request.cookies.refresh_token;
    if (!token) return reply.status(401).send({ code: "UNAUTHORIZED", message: "Refresh token is required" });
    const result = await refresh(token);
    setSessionCookies(reply, result.accessToken, result.refreshToken);
    return clientSafeSession(result);
  });

  app.post("/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    await revokeSession(request.auth.id, request.auth.sessionId);
    clearSessionCookies(reply);
    return { success: true };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (request) => ({ user: request.auth }));
  app.get("/auth/sessions", { preHandler: requireAuth }, async (request) => ({ sessions: await listSessions(request.auth) }));
  app.delete("/auth/sessions/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = sessionParams.parse(request.params);
    await revokeSession(request.auth.id, id);
    if (id === request.auth.sessionId) clearSessionCookies(reply);
    return { success: true, current: id === request.auth.sessionId };
  });
  app.post("/auth/sessions/revoke-others", { preHandler: requireAuth }, async (request) => {
    return { revoked: await revokeOtherSessions(request.auth.id, request.auth.sessionId) };
  });
}

function clientSafeSession(result: Awaited<ReturnType<typeof login>>) {
  const { platform, accessToken, refreshToken, ...safe } = result;
  return shouldExposeTokens(platform) ? { ...safe, accessToken, refreshToken } : safe;
}
export function shouldExposeTokens(platform: "web" | "android") { return platform === "android"; }

function clientContext(request: FastifyRequest) {
  return { ipAddress: request.ip, userAgent: request.headers["user-agent"] ?? "" };
}

function setSessionCookies(reply: FastifyReply, accessToken: string, refreshToken: string) {
  const secure = config.NODE_ENV === "production";
  reply.setCookie("access_token", accessToken, { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: config.ACCESS_TOKEN_TTL_SECONDS });
  reply.setCookie("refresh_token", refreshToken, { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400 });
}

function clearSessionCookies(reply: FastifyReply) {
  reply.clearCookie("access_token", { path: "/" });
  reply.clearCookie("refresh_token", { path: "/" });
}
