import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";
import { bootstrap } from "./service.js";

export async function bootstrapRoutes(app: FastifyInstance) {
  app.get("/bootstrap", { preHandler: requireAuth }, async (request) => bootstrap(request.auth.id));
}
