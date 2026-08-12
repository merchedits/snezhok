import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { metricsSnapshot } from "../../lib/metrics.js";
import { requireAuth } from "../auth/middleware.js";
import { requireGlobalAdmin } from "../admin/middleware.js";

const diagnosticCategories = [
  "auth", "call", "crash", "lifecycle", "media", "native-crash", "navigation",
  "network", "notifications", "performance", "process-exit", "storage",
] as const;
const safeMessages = new Set([
  "Android notifications could not be initialized",
  "Remote push registration failed",
  "Message notification failed",
  "Call notification failed",
  "LiveKit reconnecting",
  "LiveKit reconnected",
  "LiveKit disconnected",
  "LiveKit media device failure",
  "Initial camera publication failed",
  "LiveKit call connected",
  "Call setup failed",
  "Call lifecycle acknowledgement failed",
  "Application diagnostics initialized",
  "Fatal JavaScript error",
  "Unhandled JavaScript error",
  "Previous process ended with an uncaught native exception",
  "API request could not reach the server",
  "API request completed",
  "Upload completed",
  "Upload cancelled",
  "Upload failed",
  "Authenticated image failed",
  "Voice playback failed",
  "Video playback failed",
  "Offline cache persistence retry failed",
  "Offline cache persistence failed",
  "Remote device session cleanup failed",
  "Background transfer reconciliation failed",
  "SQLite cache unavailable; using legacy cache",
  "SQLite cache clear failed",
  "Navigation ready",
  "Route changed",
  "tabResponse",
  "warmChatOpen",
  "cachedChatOpen",
  "interactionResponse",
  "attachmentDrawerOpen",
  "mediaViewerOpen",
  "uploadChunk",
  "framePacing",
]);
const safeContextKeys = new Set([
  "attempt", "averageFps", "budgetMs", "build", "bytes", "chunks", "connection",
  "description", "errorName", "failure", "fatal", "frames", "from", "importance",
  "jankyFrames", "kind", "method", "name", "passed", "path", "p95FrameMs", "pss",
  "quality", "reason", "requestId", "route", "status", "to", "version",
]);

const eventSchema = z.object({
  at: z.number().int().nonnegative(),
  level: z.enum(["debug", "info", "warn", "error"]),
  category: z.enum(diagnosticCategories),
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

type DiagnosticReport = z.infer<typeof reportSchema>;

export function sanitizeDiagnosticReport(report: DiagnosticReport) {
  return {
    installation: createHash("sha256").update(`snezhok-diagnostics:${report.installationId}`).digest("hex").slice(0, 16),
    appVersion: redactDiagnosticText(report.appVersion),
    versionCode: report.versionCode,
    platform: report.platform,
    osVersion: redactDiagnosticText(report.osVersion),
    locale: report.locale,
    recordedAt: report.recordedAt,
    events: report.events.map((event) => ({
      at: event.at,
      level: event.level,
      category: event.category,
      message: canonicalDiagnosticMessage(event.message),
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      ...(event.context ? { context: sanitizeDiagnosticContext(event.context) } : {}),
    })),
  };
}

function canonicalDiagnosticMessage(message: string): string {
  if (safeMessages.has(message)) return message;
  if (/^Previous Android process exit: [a-z0-9_-]{1,48}$/i.test(message)) return "Previous Android process exit";
  return "Unrecognized diagnostic event";
}

function sanitizeDiagnosticContext(context: Record<string, string | number | boolean | null>) {
  return Object.fromEntries(Object.entries(context).flatMap(([key, value]) => {
    if (!safeContextKeys.has(key)) return [];
    return [[key, typeof value === "string" ? redactDiagnosticText(value) : value]];
  }));
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\beyJ[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]{8,}){1,2}\b/g, "[token]")
    .replace(/\b(authorization|bearer|cookie|email|password|token)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 160);
}

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
        ...sanitizeDiagnosticReport(report),
        requestId: request.id,
      },
    }, "mobile diagnostic report");
    return reply.status(202).send({ accepted: true, requestId: request.id });
  });
}
