import type { AuthenticatedUser } from "./modules/auth/service.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthenticatedUser;
  }
}
