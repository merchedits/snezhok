import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { installErrorHandler } from "./lib/errors.js";
import { authRoutes } from "./modules/auth/routes.js";
import { bootstrapRoutes } from "./modules/bootstrap/routes.js";
import { callRoutes } from "./modules/calls/routes.js";
import { clientRoutes } from "./modules/clients/routes.js";
import { conversationRoutes } from "./modules/conversations/routes.js";
import { friendRoutes } from "./modules/friends/routes.js";
import { messageRoutes } from "./modules/messages/routes.js";
import { searchRoutes } from "./modules/search/routes.js";
import { serverRoutes } from "./modules/servers/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";
import { uploadRoutes } from "./modules/uploads/routes.js";
import { userRoutes } from "./modules/users/routes.js";

export async function buildApp() {
  const app = Fastify({ logger: config.NODE_ENV !== "test", trustProxy: config.TRUST_PROXY_HOPS, bodyLimit: 1024 * 1024, requestIdHeader: "x-request-id" });
  app.decorateRequest("auth");
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: (origin, callback) => callback(null, !origin || config.APP_ORIGINS.includes(origin)), credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  app.addContentTypeParser("application/offset+octet-stream", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  // Native clients stream complete files here. Keeping this as a stream avoids
  // buffering voice notes and large attachments in either Android or Node.
  app.addContentTypeParser("application/octet-stream", (_request, body, done) => done(null, body));
  app.addContentTypeParser("application/webhook+json", { parseAs: "string" }, (_request, body, done) => done(null, body));

  installErrorHandler(app);
  app.get("/api/health", async () => ({ status: "ok", time: Date.now() }));
  await app.register(async (api) => {
    api.get("/health", async () => ({ status: "ok", time: Date.now() }));
    await api.register(authRoutes);
    await api.register(bootstrapRoutes);
    await api.register(userRoutes);
    await api.register(friendRoutes);
    await api.register(serverRoutes);
    await api.register(conversationRoutes);
    await api.register(messageRoutes);
    await api.register(uploadRoutes);
    await api.register(settingsRoutes);
    await api.register(searchRoutes);
    await api.register(callRoutes);
    await api.register(clientRoutes);
  }, { prefix: config.PUBLIC_API_PREFIX });
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const webDist = config.WEB_DIST_PATH ? path.resolve(config.WEB_DIST_PATH) : path.resolve(moduleDirectory, "../../web/dist");
  if (existsSync(path.join(webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/", index: false, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split("?", 1)[0] ?? "/";
      if (request.method === "GET" && !pathname.startsWith("/api/") && !pathname.startsWith("/socket.io") && !pathname.startsWith("/assets/") && !path.extname(pathname)) return reply.sendFile("index.html");
      return reply.status(404).send({ code: "NOT_FOUND", message: "Not found" });
    });
  }
  return app;
}
