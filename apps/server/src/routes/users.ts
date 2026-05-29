import { FastifyInstance } from "fastify";
import { requireAuth, requireAdmin } from "../lib/middleware.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { createInviteCode, getInviteCodes } from "../services/auth.js";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { nanoid } from "nanoid";

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
            avatarUrl: true,
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
      const { displayName, avatarColor } = request.body || {};
      const trimmedName = displayName?.trim();

      if (!trimmedName) {
        reply.status(400).send({ error: "Display name cannot be empty." });
        return;
      }

      // Validate avatar color if provided (must be a valid hex color)
      const validColor = avatarColor && /^#[0-9A-Fa-f]{6}$/.test(avatarColor) ? avatarColor : undefined;

      try {
        const updateData: Record<string, string> = { displayName: trimmedName };
        if (validColor) {
          updateData.avatarColor = validColor;
        }

        await db
          .update(users)
          .set(updateData)
          .where(eq(users.id, request.user.id));

        return { success: true, displayName: trimmedName, avatarColor: validColor || undefined };
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // Upload avatar
  fastify.post(
    "/api/users/me/avatar",
    { preHandler: [requireAuth] },
    async (request: any, reply) => {
      try {
        const data = await request.file();
        if (!data) {
          reply.status(400).send({ error: "No file uploaded." });
          return;
        }

        if (!data.mimetype.startsWith("image/")) {
          reply.status(400).send({ error: "Only image files are allowed." });
          return;
        }

        const ext = path.extname(data.filename) || ".png";
        const filename = `${request.user.id}-${nanoid()}${ext}`;
        const uploadDir = path.resolve("./data/uploads/avatars");
        
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filePath = path.join(uploadDir, filename);
        await pipeline(data.file, fs.createWriteStream(filePath));

        const avatarUrl = `/api/files/avatars/${filename}`;

        await db
          .update(users)
          .set({ avatarUrl })
          .where(eq(users.id, request.user.id));

        return { success: true, avatarUrl };
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
