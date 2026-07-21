import assert from "node:assert/strict";
import test from "node:test";
import { productionConfigurationProblems } from "./config.js";

const validProduction = {
  NODE_ENV: "production" as const,
  HOST: "0.0.0.0",
  PORT: 3000,
  DATABASE_URL: "postgresql://snezhok:opaque-password@postgres:5432/snezhok",
  DATABASE_HOST: "postgres",
  DATABASE_PORT: 5432,
  DATABASE_NAME: "snezhok",
  DATABASE_USER: "snezhok_api",
  DATABASE_PASSWORD: "T7x:@/%?#-uN9wQ4rK6mP2sV8z",
  DATABASE_POOL_MAX: 5,
  JWT_SECRET: "Q5uNQzQfbq1SjW7JNb3MALRvxUi0nGCeaz1QJHxcVhQ",
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 365,
  SOURCE_REVISION: "0123456789abcdef0123456789abcdef01234567",
  APP_ORIGINS: "https://merchedits.xyz",
  STORAGE_ROOT: "/app/data",
  MAX_UPLOAD_BYTES: 2_147_483_648,
  UPLOAD_CHUNK_BYTES: 4_194_304,
  INTERNAL_MEDIA_PREFIX: "/chat/_media/",
  USE_X_ACCEL: true,
  PUBLIC_API_PREFIX: "/api/v1",
  LIVEKIT_URL: "wss://merchedits.xyz/chat/livekit",
  LIVEKIT_CONTROL_URL: "http://host.docker.internal:7880",
  LIVEKIT_API_KEY: "production-key",
  LIVEKIT_API_SECRET: "rHsdvhmEh3zLgb7qipbXffriWcmjgOfT",
  CALL_STALE_HOURS: 12,
  CALL_PHANTOM_TIMEOUT_SECONDS: 120,
  RUN_MIGRATIONS: false,
  EVENT_RETENTION_DAYS: 30,
  ORPHAN_MEDIA_RETENTION_DAYS: 7,
  RELIABILITY_CLEANUP_INTERVAL_MINUTES: 15,
  PUSH_DELIVERY_RETENTION_DAYS: 7,
  TRUST_PROXY_HOPS: 1,
  ANDROID_APK_PATH: "/app/releases/snezhok-current.apk",
  ANDROID_RELEASE_MANIFEST_PATH: "/app/releases/android-current.json",
};

test("production configuration rejects transport and secret placeholders", () => {
  const problems = productionConfigurationProblems({
    ...validProduction,
    JWT_SECRET: "development-only-jwt-secret-change-me-now",
    LIVEKIT_URL: "ws://localhost:7880",
    LIVEKIT_CONTROL_URL: "http://127.0.0.1:7880",
    USE_X_ACCEL: false,
  });
  assert.equal(problems.some((problem) => problem.includes("JWT_SECRET")), true);
  assert.equal(problems.some((problem) => problem.includes("wss://")), true);
  assert.equal(problems.some((problem) => problem.includes("production-internal")), true);
  assert.equal(problems.some((problem) => problem.includes("X_ACCEL")), true);
});

test("production configuration accepts the hardened deployment shape", () => {
  assert.deepEqual(productionConfigurationProblems(validProduction), []);
});

test("field-based database credentials safely accept URI-reserved characters", () => {
  assert.deepEqual(productionConfigurationProblems({ ...validProduction, DATABASE_PASSWORD: "R4nD0m:@/%?#-Q7vX2kL9sT5p" }), []);
});

test("production configuration rejects an untraceable source revision", () => {
  assert.equal(productionConfigurationProblems({ ...validProduction, SOURCE_REVISION: "development" }).some((problem) => problem.includes("SOURCE_REVISION")), true);
});
