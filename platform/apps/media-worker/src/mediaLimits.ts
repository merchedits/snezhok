import type { MediaJob, OutputVariant } from "./types.js";

export interface ProbedMedia {
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export const MEDIA_LIMITS = {
  maxImagePixels: 40_000_000,
  maxVisualDimension: 8_192,
  maxStandardDurationMs: 8 * 60 * 60 * 1_000,
  maxVoiceDurationMs: 2 * 60 * 60 * 1_000,
  maxVideoNoteDurationMs: 10 * 60 * 1_000,
  maxThumbnailDimension: 320,
} as const;

export function validateSourceMetadata(job: Pick<MediaJob, "kind" | "purpose">, metadata: ProbedMedia): void {
  if (job.kind === "image" || job.kind === "video" || job.purpose === "video-note") validateVisualDimensions(metadata.width, metadata.height);
  if (job.kind === "video" || job.kind === "audio" || job.purpose === "voice" || job.purpose === "video-note") {
    const duration = metadata.durationMs;
    const maximum = job.purpose === "voice" ? MEDIA_LIMITS.maxVoiceDurationMs : job.purpose === "video-note" ? MEDIA_LIMITS.maxVideoNoteDurationMs : MEDIA_LIMITS.maxStandardDurationMs;
    if (!Number.isSafeInteger(duration) || duration! <= 0 || duration! > maximum) throw new Error("Media duration is missing or exceeds the processing limit");
  }
}

export function validateOutputVariants(job: Pick<MediaJob, "kind" | "purpose">, outputs: readonly OutputVariant[]): void {
  const visualOutput = job.purpose !== "voice" && (job.kind === "image" || job.kind === "video" || job.purpose === "video-note");
  if (outputs.filter((output) => output.role === "primary").length !== 1) throw new Error("Media processing must produce exactly one primary variant");
  if (visualOutput && outputs.filter((output) => output.role === "thumbnail").length !== 1) throw new Error("Visual media must produce exactly one thumbnail");
  for (const output of outputs) {
    if (output.role === "thumbnail") {
      if (!positiveInteger(output.width) || !positiveInteger(output.height) || output.width! > MEDIA_LIMITS.maxThumbnailDimension || output.height! > MEDIA_LIMITS.maxThumbnailDimension) {
        throw new Error("Thumbnail metadata is invalid");
      }
    } else if (visualOutput) {
      validateVisualDimensions(output.width, output.height);
    }
    if (output.durationMs !== null && (!Number.isSafeInteger(output.durationMs) || output.durationMs < 0 || output.durationMs > MEDIA_LIMITS.maxStandardDurationMs)) throw new Error("Output duration metadata is invalid");
    if (output.waveform && (output.waveform.length > 200 || output.waveform.some((value) => !Number.isInteger(value) || value < 0 || value > 100))) throw new Error("Output waveform metadata is invalid");
  }
}

function validateVisualDimensions(width: number | null, height: number | null): void {
  if (!positiveInteger(width) || !positiveInteger(height) || width! > MEDIA_LIMITS.maxVisualDimension || height! > MEDIA_LIMITS.maxVisualDimension || width! * height! > MEDIA_LIMITS.maxImagePixels) {
    throw new Error("Media dimensions are missing or exceed the processing limit");
  }
}

function positiveInteger(value: number | null): boolean {
  return Number.isSafeInteger(value) && value! > 0;
}
