import type { FastifyInstance } from "fastify";
import type { ProfilePhoto, UserProfile } from "@snezhok/contracts";
import { profilePhotoOrderSchema, profilePhotoSchema, profileUpdateSchema } from "@snezhok/contracts";
import { z } from "zod";
import { pool, transaction, type DbClient } from "../../db/pool.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { mapUser, publicUserSelect, type PublicUserRow } from "./queries.js";

const searchQuery = z.object({ q: z.string().trim().min(1).max(64) });
const userParams = z.object({ id: z.string().uuid() });
const photoParams = z.object({ attachmentId: z.string().uuid() });

export async function userRoutes(app: FastifyInstance) {
  app.get("/users/search", { preHandler: requireAuth }, async (request) => {
    const { q } = searchQuery.parse(request.query);
    const result = await pool.query<PublicUserRow>(
      `SELECT ${publicUserSelect} FROM users u WHERE u.id<>$1 AND (u.username ILIKE $2 OR u.display_name ILIKE $2) ORDER BY u.username LIMIT 20`,
      [request.auth.id, `%${q}%`],
    );
    return { users: result.rows.map(mapUser) };
  });

  app.get("/users/:id/profile", { preHandler: requireAuth }, async (request) => {
    return { profile: await loadProfile(userParams.parse(request.params).id) };
  });

  app.patch("/users/me", { preHandler: requireAuth }, async (request) => {
    const body = profileUpdateSchema.parse(request.body);
    await pool.query(
      `UPDATE users SET display_name=coalesce($2,display_name),bio=coalesce($3,bio),status_text=coalesce($4,status_text),updated_at=now() WHERE id=$1`,
      [request.auth.id, body.displayName ?? null, body.bio ?? null, body.statusText ?? null],
    );
    return { user: (await loadProfile(request.auth.id)).user };
  });

  app.post("/users/me/profile-photos", { preHandler: requireAuth }, async (request, reply) => {
    const { attachmentId } = profilePhotoSchema.parse(request.body);
    await transaction(async (client) => {
      await lockProfile(request.auth.id, client);
      const attachment = await client.query<{ id: string }>(
        `SELECT id FROM attachments WHERE id=$1 AND owner_id=$2 AND kind='image' AND mime_type LIKE 'image/%' AND status IN ('processing','ready')`,
        [attachmentId, request.auth.id],
      );
      if (!attachment.rowCount) throw forbidden("Profile photo must be an image uploaded by this account");
      const current = await photoIds(request.auth.id, client);
      if (!current.includes(attachmentId) && current.length >= 10) throw conflict("A profile can contain at most 10 photos");
      if (!current.includes(attachmentId)) {
        await client.query("INSERT INTO user_profile_photos(user_id,attachment_id,position) VALUES ($1,$2,$3)", [request.auth.id, attachmentId, current.length]);
      }
      await setPhotoOrder(request.auth.id, [attachmentId, ...current.filter((id) => id !== attachmentId)], client);
    });
    return reply.status(201).send({ profile: await loadProfile(request.auth.id) });
  });

  app.patch("/users/me/profile-photos/order", { preHandler: requireAuth }, async (request) => {
    const { attachmentIds } = profilePhotoOrderSchema.parse(request.body);
    await transaction(async (client) => {
      await lockProfile(request.auth.id, client);
      const current = await photoIds(request.auth.id, client);
      if (!samePhotoSet(current, attachmentIds)) throw conflict("Photo order must contain every current profile photo exactly once");
      await setPhotoOrder(request.auth.id, attachmentIds, client);
    });
    return { profile: await loadProfile(request.auth.id) };
  });

  app.delete("/users/me/profile-photos/:attachmentId", { preHandler: requireAuth }, async (request) => {
    const { attachmentId } = photoParams.parse(request.params);
    await transaction(async (client) => {
      await lockProfile(request.auth.id, client);
      const result = await client.query("DELETE FROM user_profile_photos WHERE user_id=$1 AND attachment_id=$2", [request.auth.id, attachmentId]);
      if (!result.rowCount) throw notFound("Profile photo not found");
      await setPhotoOrder(request.auth.id, await photoIds(request.auth.id, client), client);
    });
    return { profile: await loadProfile(request.auth.id) };
  });
}

async function loadProfile(userId: string): Promise<UserProfile> {
  const userResult = await pool.query<PublicUserRow>(`SELECT ${publicUserSelect} FROM users u WHERE u.id=$1`, [userId]);
  if (!userResult.rows[0]) throw notFound("User not found");
  const photos = await pool.query<{
    attachment_id: string; position: number; created_at_ms: number; primary_id: string | null; thumbnail_id: string | null; thumbnail_attachment_id: string | null;
  }>(
    `SELECT p.attachment_id,p.position,(extract(epoch from p.created_at)*1000)::bigint::float8 created_at_ms,
            source.id primary_id,t.id thumbnail_id,a.thumbnail_attachment_id
     FROM user_profile_photos p JOIN attachments a ON a.id=p.attachment_id
     LEFT JOIN LATERAL (SELECT id FROM media_variants WHERE attachment_id=a.id AND role='primary' ORDER BY created_at DESC LIMIT 1) source ON true
     LEFT JOIN LATERAL (SELECT id FROM media_variants WHERE attachment_id=a.id AND role='thumbnail' ORDER BY created_at DESC LIMIT 1) t ON true
     WHERE p.user_id=$1 ORDER BY p.position`,
    [userId],
  );
  return {
    user: mapUser(userResult.rows[0]),
    photos: photos.rows.map((row): ProfilePhoto => ({
      id: row.attachment_id,
      url: row.primary_id ? `/api/v1/files/${row.attachment_id}?variant=${row.primary_id}` : `/api/v1/files/${row.attachment_id}`,
      thumbnailUrl: row.thumbnail_id ? `/api/v1/files/${row.attachment_id}?variant=${row.thumbnail_id}` : row.thumbnail_attachment_id ? `/api/v1/files/${row.thumbnail_attachment_id}` : null,
      position: row.position,
      createdAt: Number(row.created_at_ms),
    })),
  };
}

async function lockProfile(userId: string, client: DbClient) {
  const user = await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
  if (!user.rowCount) throw notFound("User not found");
}

async function photoIds(userId: string, client: Pick<DbClient, "query">) {
  return (await client.query<{ attachment_id: string }>("SELECT attachment_id FROM user_profile_photos WHERE user_id=$1 ORDER BY position", [userId])).rows.map((row) => row.attachment_id);
}

async function setPhotoOrder(userId: string, attachmentIds: string[], client: DbClient) {
  await client.query("SET CONSTRAINTS user_profile_photos_position_unique DEFERRED");
  for (const [position, attachmentId] of attachmentIds.entries()) {
    await client.query("UPDATE user_profile_photos SET position=$3 WHERE user_id=$1 AND attachment_id=$2", [userId, attachmentId, position]);
  }
  await client.query("UPDATE users SET avatar_attachment_id=$2,updated_at=now() WHERE id=$1", [userId, attachmentIds[0] ?? null]);
}

export function samePhotoSet(current: string[], requested: string[]) {
  return current.length === requested.length && current.every((id) => requested.includes(id)) && new Set(requested).size === requested.length;
}
