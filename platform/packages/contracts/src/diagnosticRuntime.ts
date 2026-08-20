import { z } from "zod";

export const diagnosticCategories = [
  "auth", "call", "crash", "lifecycle", "media", "native-crash", "navigation",
  "network", "notifications", "performance", "process-exit", "storage",
] as const;

export const diagnosticEventSchema = z.object({
  id: z.string().uuid(),
  at: z.number().int().nonnegative(),
  level: z.enum(["debug", "info", "warn", "error"]),
  category: z.enum(diagnosticCategories),
  message: z.string().trim().min(1).max(240),
  durationMs: z.number().finite().nonnegative().max(600_000).optional(),
  context: z.record(z.string(), z.union([z.string().max(160), z.number().finite(), z.boolean(), z.null()])).optional(),
});

export const diagnosticReportSchema = z.object({
  installationId: z.string().min(8).max(80),
  appVersion: z.string().max(32),
  versionCode: z.number().int().positive(),
  platform: z.literal("android"),
  osVersion: z.string().max(32),
  device: z.string().max(80),
  locale: z.enum(["ru", "en"]),
  recordedAt: z.number().int().nonnegative(),
  events: z.array(diagnosticEventSchema).max(200),
});

export const diagnosticAggregateSchema = z.object({
  bucketDate: z.string().date(),
  appVersion: z.string().max(32),
  versionCode: z.number().int().positive(),
  osVersion: z.string().max(32),
  device: z.string().max(80),
  category: z.enum(diagnosticCategories),
  level: z.enum(["debug", "info", "warn", "error"]),
  eventName: z.string().max(240),
  occurrences: z.number().int().nonnegative(),
  firstSeenAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
  maxDurationMs: z.number().finite().nonnegative().nullable(),
});

export const diagnosticAggregatesEnvelopeSchema = z.object({
  aggregates: z.array(diagnosticAggregateSchema).max(500),
});

export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>;
export type DiagnosticReport = z.infer<typeof diagnosticReportSchema>;
export type DiagnosticAggregate = z.infer<typeof diagnosticAggregateSchema>;
