import type { FastifyInstance } from "fastify";
import type { AppSettings } from "@snezhok/contracts";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../auth/middleware.js";
import { defaultSettings } from "./defaults.js";

const settingsSchema = z.object({
  theme: z.enum(["system","light","dark"]), accent: z.enum(["blue","green","purple","orange","red"]),
  fontScale: z.number().min(.8).max(1.5), density: z.enum(["compact","comfortable"]), bubbleRadius: z.number().int().min(0).max(24),
  reducedMotion: z.boolean(), highContrast: z.boolean(), language: z.enum(["en","ru"]), readReceipts: z.boolean(), showLastSeen: z.boolean(),
  stripMediaLocation: z.boolean(), defaultUploadQuality: z.enum(["data-saver","auto","high","original"]), autoDownloadWifi: z.boolean(),
  autoDownloadMobile: z.boolean(), noiseSuppression: z.enum(["off","standard","high"]), echoCancellation: z.boolean(), autoGainControl: z.boolean(),
  microphoneMode: z.enum(["system","phone","speakerphone"]), pushToTalk: z.boolean(),
}).partial();

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/settings", { preHandler: requireAuth }, async (request) => {
    const result = await pool.query<{ settings: Partial<AppSettings> }>("SELECT settings FROM user_settings WHERE user_id=$1", [request.auth.id]);
    return { settings: { ...defaultSettings, ...(result.rows[0]?.settings ?? {}) } };
  });
  app.patch("/settings", { preHandler: requireAuth }, async (request) => {
    const patch = settingsSchema.parse(request.body);
    const result = await pool.query<{ settings: AppSettings }>(
      `INSERT INTO user_settings(user_id,settings) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE
       SET settings=user_settings.settings || EXCLUDED.settings,updated_at=now() RETURNING settings`, [request.auth.id, patch]);
    return { settings: { ...defaultSettings, ...result.rows[0]!.settings } };
  });
}
