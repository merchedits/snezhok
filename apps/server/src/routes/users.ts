import { FastifyInstance } from "fastify";
import { requireAuth, requireAdmin } from "../lib/middleware.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { createInviteCode, getInviteCodes } from "../services/auth.js";

export async function userRoutes(fastify: FastifyInstance) {
  // List all users in system
  fastify.get(
    "/api/users",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const allUsers = await db.query.users.findMany({
          columns: {
            id: true,
            username: true,
            displayName: true,
            avatarColor: true,
            isAdmin: true,
            createdAt: true,
            lastSeenAt: true,
          },
          orderBy: [desc(users.lastSeenAt)],
        });
        return { users: allUsers };
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // Update profile
  fastify.put(
    "/api/users/me",
    { preHandler: [requireAuth] },
    async (request: any, reply) => {
      const { displayName } = request.body || {};
      const trimmedName = displayName?.trim();

      if (!trimmedName) {
        reply.status(400).send({ error: "Display name cannot be empty." });
        return;
      }

      try {
        await db
          .update(users)
          .set({ displayName: trimmedName })
          .where(eq(users.id, request.user.id));

        return { success: true, displayName: trimmedName };
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // Admin: Generate invite code
  fastify.post(
    "/api/users/invite",
    { preHandler: [requireAdmin] },
    async (request: any, reply) => {
      const { code } = request.body || {};
      try {
        const invite = await createInviteCode(request.user.id, code);
        return { success: true, invite };
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
      }
    }
  );

  // Admin: List all invite codes
  fastify.get(
    "/api/users/invites",
    { preHandler: [requireAdmin] },
    async (request: any, reply) => {
      try {
        const invites = await getInviteCodes(request.user.id);
        return { invites };
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );
}
