import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { metricsSnapshot } from "../../lib/metrics.js";
import { requireAuth } from "../auth/middleware.js";
import { requireGlobalAdmin } from "../admin/middleware.js";

const eventSchema = z.object({
  at: z.number().int().nonnegative(),
  level: z.enum(["debug", "info", "warn", "error"]),
  category: z.string().trim().min(1).max(48),
  message: z.string().trim().min(1).max(240),
  durationMs: z.number().nonnegative().max(600_000).optional(),
  context: z.record(z.string(), z.union([z.string().max(160), z.number(), z.boolean(), z.null()])).optional(),
});

const reportSchema = z.object({
  installationId: z.string().min(8).max(80),
  appVersion: z.string().max(32),
  versionCode: z.number().int().positive(),
  platform: z.literal("android"),
  osVersion: z.string().max(32),
  device: z.string().max(80),
  locale: z.enum(["ru", "en"]),
  recordedAt: z.number().int().nonnegative(),
  events: z.array(eventSchema).max(200),
});

export async function diagnosticRoutes(app: FastifyInstance) {
  app.get("/diagnostics/health", { preHandler: requireGlobalAdmin }, async (request) => {
    const databaseStarted = performance.now();
    await pool.query("SELECT 1");
    const memory = process.memoryUsage();
    return {
      status: "ok",
      requestId: request.id,
      databaseLatencyMs: Math.round((performance.now() - databaseStarted) * 10) / 10,
      databasePool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
      process: {
        uptimeSeconds: Math.floor(process.uptime()),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
      },
      metrics: metricsSnapshot(),
      checkedAt: Date.now(),
    };
  });

  app.post("/diagnostics/client-reports", { preHandler: requireAuth }, async (request, reply) => {
    const report = reportSchema.parse(request.body);
    request.log.warn({
      diagnosticReport: {
        ...report,
        userId: request.auth.id,
        requestId: request.id,
      },
    }, "mobile diagnostic report");
    return reply.status(202).send({ accepted: true, requestId: request.id });
  });
}
