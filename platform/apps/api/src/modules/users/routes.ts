import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../auth/middleware.js";
import { mapUser, publicUserSelect, type PublicUserRow } from "./queries.js";

const searchQuery = z.object({ q: z.string().trim().min(1).max(64) });
const profileSchema = z.object({ displayName: z.string().trim().min(1).max(48).optional(), bio: z.string().max(512).optional(), statusText: z.string().max(128).optional() });

export async function userRoutes(app: FastifyInstance) {
  app.get("/users/search", { preHandler: requireAuth }, async (request) => {
    const { q } = searchQuery.parse(request.query);
    const result = await pool.query<PublicUserRow>(
      `SELECT ${publicUserSelect} FROM users u WHERE u.id<>$1 AND (u.username ILIKE $2 OR u.display_name ILIKE $2) ORDER BY u.username LIMIT 20`,
      [request.auth.id, `%${q}%`],
    );
    return { users: result.rows.map(mapUser) };
  });
  app.patch("/users/me", { preHandler: requireAuth }, async (request) => {
    const body = profileSchema.parse(request.body);
    await pool.query(
      `UPDATE users SET display_name=coalesce($2,display_name),bio=coalesce($3,bio),status_text=coalesce($4,status_text),updated_at=now() WHERE id=$1`,
      [request.auth.id, body.displayName ?? null, body.bio ?? null, body.statusText ?? null],
    );
    const result = await pool.query<PublicUserRow>(`SELECT ${publicUserSelect} FROM users u WHERE u.id=$1`, [request.auth.id]);
    return { user: mapUser(result.rows[0]!) };
  });
}
