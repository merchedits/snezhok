import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1).default("postgres://snezhok:snezhok@127.0.0.1:5432/snezhok"),
  STORAGE_ROOT: z.string().default("./data"),
  WORKER_ID: z.string().min(1).default(`media-${process.pid}`),
  POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_500),
  STALE_JOB_SECONDS: z.coerce.number().int().min(30).max(86_400).default(300),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  PROCESS_NICENESS: z.coerce.number().int().min(0).max(19).default(10),
  FFMPEG_THREADS: z.coerce.number().int().min(1).max(8).default(2),
  MEDIA_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(30 * 60_000),
  MAX_MEDIA_OUTPUT_BYTES: z.coerce.number().int().min(1024).default(2 * 1024 * 1024 * 1024),
  PAUSE_DURING_CALLS: z.preprocess((value) => value !== "false", z.boolean()).default(true),
  CALL_STALE_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  MIN_FREE_MEMORY_MB: z.coerce.number().int().min(64).default(384),
  MAX_LOAD_PER_CPU: z.coerce.number().min(0.1).default(0.9),
});

export const config = schema.parse(process.env);
