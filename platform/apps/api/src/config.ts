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

if (parsed.NODE_ENV === "production") {
  for (const [name, value] of [
    ["JWT_SECRET", parsed.JWT_SECRET],
    ["LIVEKIT_API_SECRET", parsed.LIVEKIT_API_SECRET],
  ] as const) {
    if (value.startsWith("development-")) throw new Error(`${name} must be configured in production`);
  }
}

export const config = {
  ...parsed,
  APP_ORIGINS: parsed.APP_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
};

export type Config = typeof config;
