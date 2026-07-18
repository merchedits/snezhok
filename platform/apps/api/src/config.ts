import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  DATABASE_URL: z.string().min(1).default("postgres://snezhok:snezhok@127.0.0.1:5432/snezhok"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  JWT_SECRET: z.string().min(32).default("development-only-jwt-secret-change-me-now"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(365),
  APP_ORIGINS: z.string().default("http://localhost:5173"),
  STORAGE_ROOT: z.string().default("./data"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),
  UPLOAD_CHUNK_BYTES: z.coerce.number().int().min(64 * 1024).default(4 * 1024 * 1024),
  INTERNAL_MEDIA_PREFIX: z.string().default("/_protected-media/"),
  USE_X_ACCEL: z.preprocess((value) => value === "true", z.boolean()).default(false),
  PUBLIC_API_PREFIX: z.string().default("/api/v1"),
  LIVEKIT_URL: z.string().url().default("wss://rtc.example.invalid"),
  LIVEKIT_API_KEY: z.string().default("development-key"),
  LIVEKIT_API_SECRET: z.string().default("development-secret"),
  CALL_STALE_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  EVENT_RETENTION_DAYS: z.coerce.number().int().min(7).max(365).default(30),
  ORPHAN_MEDIA_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  RELIABILITY_CLEANUP_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1_440).default(15),
  PUSH_DELIVERY_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(4).default(1),
  WEB_DIST_PATH: z.string().optional(),
  ANDROID_APK_PATH: z.string().optional(),
  ANDROID_RELEASE_MANIFEST_PATH: z.string().optional(),
});

const parsed = schema.parse(process.env);

export function productionConfigurationProblems(input: z.infer<typeof schema>): string[] {
  if (input.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  const obviousPlaceholder = /development|replace|example|change[-_ ]?me|not-a-production|localhost/i;
  if (obviousPlaceholder.test(input.JWT_SECRET) || new Set(input.JWT_SECRET).size < 12) problems.push("JWT_SECRET must be a unique high-entropy production secret");
  if (obviousPlaceholder.test(input.LIVEKIT_API_KEY)) problems.push("LIVEKIT_API_KEY must be configured for production");
  if (obviousPlaceholder.test(input.LIVEKIT_API_SECRET) || input.LIVEKIT_API_SECRET.length < 24) problems.push("LIVEKIT_API_SECRET must be a high-entropy production secret");
  if (!input.DATABASE_URL.startsWith("postgresql://") && !input.DATABASE_URL.startsWith("postgres://")) problems.push("DATABASE_URL must use PostgreSQL");
  if (obviousPlaceholder.test(input.DATABASE_URL)) problems.push("DATABASE_URL must not use development credentials or localhost");
  if (!input.LIVEKIT_URL.startsWith("wss://")) problems.push("LIVEKIT_URL must use wss:// in production");
  if (!input.APP_ORIGINS.length || input.APP_ORIGINS.split(",").some((origin) => !origin.trim().startsWith("https://"))) problems.push("APP_ORIGINS must contain only HTTPS origins");
  if (!input.USE_X_ACCEL) problems.push("USE_X_ACCEL must be enabled so protected media is served by the reverse proxy");
  if (!input.ANDROID_APK_PATH || !input.ANDROID_RELEASE_MANIFEST_PATH) problems.push("Android APK and release manifest paths are required for the private update channel");
  return problems;
}

const productionProblems = productionConfigurationProblems(parsed);
if (productionProblems.length) throw new Error(`Invalid production configuration:\n- ${productionProblems.join("\n- ")}`);

export const config = {
  ...parsed,
  APP_ORIGINS: parsed.APP_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
};

export type Config = typeof config;
