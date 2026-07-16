import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { newId } from "../../lib/ids.js";
import { conflict } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { resolveStreamAccess } from "../streams/access.js";

const deviceSchema = z.object({
  token: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),
  installationId: z.string().min(8).max(128),
  appVersion: z.string().min(1).max(32),
  platform: z.literal("android"),
});
const streamParams = z.object({ streamId: z.string().uuid() });
const streamPolicySchema = z.object({
  streamKind: z.enum(["conversation", "channel"]),
  enabled: z.boolean().default(true),
  showPreview: z.boolean().nullable().default(null),
  mutedUntil: z.number().int().positive().nullable().default(null),
});

export async function notificationRoutes(app: FastifyInstance) {
  app.post("/notifications/devices", { preHandler: requireAuth }, async (request) => {
    const input = deviceSchema.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM push_devices WHERE expo_push_token=$1 OR (user_id=$2 AND installation_id=$3)", [input.token, request.auth.id, input.installationId]);
      await client.query("INSERT INTO push_devices(id,user_id,expo_push_token,platform,installation_id,app_version) VALUES ($1,$2,$3,$4,$5,$6)", [newId(), request.auth.id, input.token, input.platform, input.installationId, input.appVersion]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { registered: true };
  });

  app.delete("/notifications/devices/:installationId", { preHandler: requireAuth }, async (request, reply) => {
    const { installationId } = z.object({ installationId: z.string().min(8).max(128) }).parse(request.params);
    await pool.query("DELETE FROM push_devices WHERE user_id=$1 AND installation_id=$2", [request.auth.id, installationId]);
    return reply.status(204).send();
  });

  app.get("/notifications/streams", { preHandler: requireAuth }, async (request) => {
    const result = await pool.query<{ stream_kind: "conversation" | "channel"; stream_id: string; enabled: boolean; show_preview: boolean | null; muted_until_ms: number | null }>(
      `SELECT stream_kind,stream_id,enabled,show_preview,
       CASE WHEN muted_until IS NULL THEN NULL ELSE (extract(epoch from muted_until)*1000)::bigint::float8 END muted_until_ms
       FROM stream_notification_settings WHERE user_id=$1 ORDER BY updated_at DESC`,
      [request.auth.id],
    );
    return { items: result.rows.map((row) => ({ streamKind: row.stream_kind, streamId: row.stream_id, enabled: row.enabled, showPreview: row.show_preview, mutedUntil: row.muted_until_ms })) };
  });

  app.put("/notifications/streams/:streamId", { preHandler: requireAuth }, async (request) => {
    const { streamId } = streamParams.parse(request.params);
    const input = streamPolicySchema.parse(request.body);
    const access = await resolveStreamAccess(request.auth.id, streamId);
    if (access.streamKind !== input.streamKind) throw conflict("Notification stream kind does not match the resource");
    await pool.query(
      `INSERT INTO stream_notification_settings(user_id,stream_kind,stream_id,enabled,show_preview,muted_until)
       VALUES ($1,$2,$3,$4,$5,CASE WHEN $6::bigint IS NULL THEN NULL ELSE to_timestamp($6::double precision/1000) END)
       ON CONFLICT(user_id,stream_kind,stream_id) DO UPDATE SET enabled=EXCLUDED.enabled,show_preview=EXCLUDED.show_preview,muted_until=EXCLUDED.muted_until,updated_at=now()`,
      [request.auth.id, input.streamKind, streamId, input.enabled, input.showPreview, input.mutedUntil],
    );
    return { success: true };
  });

  app.delete("/notifications/streams/:streamId", { preHandler: requireAuth }, async (request, reply) => {
    const { streamId } = streamParams.parse(request.params);
    await pool.query("DELETE FROM stream_notification_settings WHERE user_id=$1 AND stream_id=$2", [request.auth.id, streamId]);
    return reply.status(204).send();
  });
}
