import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { newId } from "../../lib/ids.js";
import { requireAuth } from "../auth/middleware.js";

const deviceSchema = z.object({
  token: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),
  installationId: z.string().min(8).max(128),
  appVersion: z.string().min(1).max(32),
  platform: z.literal("android"),
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
}
