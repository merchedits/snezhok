import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { diagnosticReportSchema, type DiagnosticReport } from "@snezhok/contracts";
import { pool } from "../../db/pool.js";
import { metricsSnapshot } from "../../lib/metrics.js";
import { requireAuth } from "../auth/middleware.js";
import { requireGlobalAdmin } from "../admin/middleware.js";
import { diagnosticProblemCount, persistDiagnosticReport, recentDiagnosticAggregates } from "./aggregation.js";

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
  "Application initialization failed",
  "Could not configure media cache",
  "Fatal JavaScript error",
  "Unhandled JavaScript error",
  "Isolated content render failure",
  "Isolated attachment render failure",
  "Previous process ended with an uncaught native exception",
  "API request could not reach the server",
  "API request completed",
  "Durable event projection failed",
  "Invalid realtime event",
  "Realtime synchronization paused",
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
  "Expired session cleanup was incomplete",
  "Invalid durable mutation records were quarantined",
  "Durable mutation queue could not be decoded",
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
  "quality", "reason", "requestId", "route", "status", "to", "version", "type", "thread",
  "reasonCode", "recordedAt", "timestamp", "pssKb", "rssKb", "issueCount", "count", "source", "frame",
]);

const aggregateQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) });

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
      id: event.id,
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
    const databaseLatencyMs = Math.round((performance.now() - databaseStarted) * 10) / 10;
    const problems24h = await diagnosticProblemCount();
    const memory = process.memoryUsage();
    return {
      status: "ok",
      requestId: request.id,
      databaseLatencyMs,
      databasePool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
      process: {
        uptimeSeconds: Math.floor(process.uptime()),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
      },
      clientDiagnostics: { problems24h },
      metrics: metricsSnapshot(),
      checkedAt: Date.now(),
    };
  });

  app.post("/diagnostics/client-reports", { preHandler: requireAuth }, async (request, reply) => {
    const report = diagnosticReportSchema.parse(request.body);
    const sanitized = sanitizeDiagnosticReport(report);
    await persistDiagnosticReport({ ...report, ...sanitized, installationId: sanitized.installation });
    request.log.warn({
      diagnosticReport: {
        ...sanitized,
        requestId: request.id,
      },
    }, "mobile diagnostic report");
    return reply.status(202).send({ accepted: true, requestId: request.id });
  });

  app.get("/diagnostics/aggregates", { preHandler: requireGlobalAdmin }, async (request) => {
    const { days } = aggregateQuerySchema.parse(request.query);
    return { aggregates: await recentDiagnosticAggregates(days) };
  });
}
