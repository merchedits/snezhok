import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
import { MEDIA_LIMITS, validateOutputVariants, validateSourceMetadata } from "./mediaLimits.js";
import { runMediaCommand } from "./subprocess.js";
import type { MediaJob, OutputVariant, Quality } from "./types.js";

export interface ProcessContext {
  signal: AbortSignal;
  heartbeat: () => Promise<void>;
  collageInputs?: string[];
}

const imageProfiles: Record<Exclude<Quality, "original">, { size: number; quality: number }> = {
  "data-saver": { size: 1280, quality: 72 },
  auto: { size: 2560, quality: 82 },
  high: { size: 3840, quality: 90 },
};
const videoProfiles: Record<
  Exclude<Quality, "original">,
  {
    maxDimension: number;
    crf: number;
    maxRate: string;
    bufferSize: string;
    audio: string;
  }
> = {
  // Telegram Android exposes 854, 1280 and 1920-pixel long-edge tiers. The
  // capped CRF encode preserves easy scenes efficiently while bounding bursts
  // so a message can begin playing quickly on mobile data.
  "data-saver": {
    maxDimension: 854,
    crf: 27,
    maxRate: "900k",
    bufferSize: "1800k",
    audio: "64k",
  },
  auto: {
    maxDimension: 1280,
    crf: 24,
    maxRate: "1800k",
    bufferSize: "3600k",
    audio: "96k",
  },
  high: {
    maxDimension: 1920,
    crf: 22,
    maxRate: "3500k",
    bufferSize: "7000k",
    audio: "128k",
  },
};

export async function processMedia(job: MediaJob, input: string, directory: string, context: ProcessContext): Promise<OutputVariant[]> {
  if (job.operation === "color-collage") {
    const outputs = await processColorCollage(context.collageInputs ?? [], directory, context);
    validateOutputVariants(job, outputs);
    return outputs;
  }
  if (job.kind === "image") {
    const metadata = await sharp(input, {
      failOn: "warning",
      limitInputPixels: MEDIA_LIMITS.maxImagePixels,
    }).metadata();
    const rotated = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
    validateSourceMetadata(job, {
      width: rotated ? (metadata.height ?? null) : (metadata.width ?? null),
      height: rotated ? (metadata.width ?? null) : (metadata.height ?? null),
      durationMs: null,
    });
  } else {
    validateSourceMetadata(job, await probe(input, context));
  }
  const outputs = job.purpose === "voice" ? await processVoice(job, input, directory, context) : job.purpose === "video-note" ? await processVideoNote(job, input, directory, context) : job.profile === "original" ? await processOriginal(job, input, directory, context) : job.kind === "image" ? await processImage(job, input, directory) : job.kind === "video" ? await processVideo(job, input, directory, context) : job.kind === "audio" ? await processAudio(job, input, directory, context) : [];
  validateOutputVariants(job, outputs);
  return outputs;
}

async function processColorCollage(inputs: string[], directory: string, context: ProcessContext): Promise<OutputVariant[]> {
  if (inputs.length !== 9) throw new Error("Color collage requires exactly nine source images");
  const tileSize = 720;
  const tiles: Buffer[] = [];
  // Decode one source at a time. Nine concurrent phone photos can otherwise
  // exceed the small production host's memory even though each output tile is bounded.
  for (const [index, source] of inputs.entries()) {
    if (context.signal.aborted) throw new DOMException("Media job cancelled", "AbortError");
    tiles.push(
      await sharp(source, {
        failOn: "warning",
        limitInputPixels: MEDIA_LIMITS.maxImagePixels,
      })
        .rotate()
        .resize(tileSize, tileSize, { fit: "cover", position: "attention" })
        .webp({ quality: 88 })
        .toBuffer(),
    );
    if (index === 2 || index === 5) await context.heartbeat();
  }
  const primary = path.join(directory, "color-collage.png");
  const thumbnail = path.join(directory, "thumbnail.webp");
  const primaryMeta = await sharp({
    create: { width: 2160, height: 2160, channels: 3, background: "#121218" },
  })
    .composite(
      tiles.map((input, index) => ({
        input,
        left: (index % 3) * tileSize,
        top: Math.floor(index / 3) * tileSize,
      })),
    )
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(primary);
  const thumbnailMeta = await sharp(await readFile(primary))
    .resize(320, 320, { fit: "cover" })
    .webp({ quality: 76, effort: 4 })
    .toFile(thumbnail);
  return [variant("primary", "color-collage-2160", primary, "image/png", primaryMeta.width, primaryMeta.height), variant("thumbnail", "thumbnail-320", thumbnail, "image/webp", thumbnailMeta.width, thumbnailMeta.height)];
}

async function processOriginal(job: MediaJob, input: string, directory: string, context: ProcessContext): Promise<OutputVariant[]> {
  if (job.kind === "image") {
    const metadata = await sharp(input, {
      limitInputPixels: MEDIA_LIMITS.maxImagePixels,
    }).metadata();
    const rotated = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
    const thumbnail = path.join(directory, "thumbnail.webp");
    const thumbMeta = await sharp(input, {
      failOn: "warning",
      limitInputPixels: MEDIA_LIMITS.maxImagePixels,
    })
      .rotate()
      .resize({
        width: 320,
        height: 320,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 72 })
      .toFile(thumbnail);
    return [variant("primary", "original", input, job.originalMimeType, rotated ? metadata.height : metadata.width, rotated ? metadata.width : metadata.height), variant("thumbnail", "thumbnail-320", thumbnail, "image/webp", thumbMeta.width, thumbMeta.height)];
  }
  const metadata = await probe(input, context);
  const primary = variant("primary", "original", input, job.originalMimeType, metadata.width, metadata.height, metadata.durationMs);
  return job.kind === "video" ? [primary, await videoThumbnail(input, directory, context)] : [primary];
}

async function processImage(job: MediaJob, input: string, directory: string): Promise<OutputVariant[]> {
  const profile = imageProfiles[job.profile === "original" ? "high" : job.profile];
  const primary = path.join(directory, "primary.webp");
  const thumbnail = path.join(directory, "thumbnail.webp");
  // rotate() honors EXIF orientation; omitting withMetadata() strips EXIF/IPTC/XMP and location data.
  const mainMeta = await sharp(input, {
    failOn: "warning",
    limitInputPixels: MEDIA_LIMITS.maxImagePixels,
  })
    .rotate()
    .resize({
      width: profile.size,
      height: profile.size,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: profile.quality, effort: 4 })
    .toFile(primary);
  const thumbMeta = await sharp(input, {
    failOn: "warning",
    limitInputPixels: MEDIA_LIMITS.maxImagePixels,
  })
    .rotate()
    .resize({
      width: 320,
      height: 320,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 72, effort: 4 })
    .toFile(thumbnail);
  return [variant("primary", job.profile, primary, "image/webp", mainMeta.width, mainMeta.height), variant("thumbnail", "thumbnail-320", thumbnail, "image/webp", thumbMeta.width, thumbMeta.height)];
}

async function processVideo(job: MediaJob, input: string, directory: string, context: ProcessContext): Promise<OutputVariant[]> {
  const profile = videoProfiles[job.profile === "original" ? "high" : job.profile];
  const primary = path.join(directory, "primary.mp4");
  const scale = `scale=w='min(iw,${profile.maxDimension})':h='min(ih,${profile.maxDimension})':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`;
  await ffmpeg(["-y", "-i", input, "-map_metadata", "-1", "-map_chapters", "-1", "-vf", scale, "-c:v", "libx264", "-preset", "medium", "-profile:v", "main", "-level:v", "4.0", "-crf", String(profile.crf), "-maxrate", profile.maxRate, "-bufsize", profile.bufferSize, "-force_key_frames", "expr:gte(t,n_forced*1)", "-pix_fmt", "yuv420p", "-threads", String(config.FFMPEG_THREADS), "-c:a", "aac", "-b:a", profile.audio, "-movflags", "+faststart", primary], context);
  const metadata = await probe(primary, context);
  const thumb = await videoThumbnail(primary, directory, context);
  return [variant("primary", job.profile, primary, "video/mp4", metadata.width, metadata.height, metadata.durationMs), thumb];
}

async function processVideoNote(job: MediaJob, input: string, directory: string, context: ProcessContext): Promise<OutputVariant[]> {
  const primary = path.join(directory, "video-note.mp4");
  await ffmpeg(["-y", "-i", input, "-map_metadata", "-1", "-map_chapters", "-1", "-vf", "scale=480:480:force_original_aspect_ratio=increase:flags=lanczos,crop=480:480", "-c:v", "libx264", "-preset", "medium", "-profile:v", "main", "-level:v", "3.1", "-crf", "25", "-maxrate", "900k", "-bufsize", "1800k", "-force_key_frames", "expr:gte(t,n_forced*1)", "-pix_fmt", "yuv420p", "-threads", String(config.FFMPEG_THREADS), "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", primary], context);
  const metadata = await probe(primary, context);
  const thumb = await videoThumbnail(primary, directory, context);
  return [variant("primary", "video-note-480", primary, "video/mp4", 480, 480, metadata.durationMs), thumb];
}

async function processVoice(job: MediaJob, input: string, directory: string, context: ProcessContext): Promise<OutputVariant[]> {
  const primary = path.join(directory, "voice.ogg");
  await ffmpeg(["-y", "-i", input, "-map_metadata", "-1", "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "48k", "-application", "voip", primary], context);
  const metadata = await probe(primary, context);
  const envelope = createWaveformAccumulator(Math.max(1, Math.ceil((metadata.durationMs ?? 1) * 8)), 100);
  await ffmpeg(["-v", "error", "-i", primary, "-f", "s16le", "-ac", "1", "-ar", "8000", "pipe:1"], { ...context, onStdoutChunk: envelope.push });
  return [
    {
      ...variant("primary", "voice-opus", primary, "audio/ogg", null, null, metadata.durationMs),
      waveform: envelope.finish(),
    },
  ];
}

async function processAudio(job: MediaJob, input: string, directory: string, context: ProcessContext): Promise<OutputVariant[]> {
  const primary = path.join(directory, "audio.ogg");
  const bitrate = job.profile === "data-saver" ? "64k" : job.profile === "high" ? "160k" : "96k";
  await ffmpeg(["-y", "-i", input, "-map_metadata", "-1", "-vn", "-c:a", "libopus", "-b:a", bitrate, primary], context);
  const metadata = await probe(primary, context);
  return [variant("primary", job.profile, primary, "audio/ogg", null, null, metadata.durationMs)];
}

async function videoThumbnail(input: string, directory: string, context: ProcessContext): Promise<OutputVariant> {
  const frame = path.join(directory, "frame.jpg");
  const thumbnail = path.join(directory, "thumbnail.webp");
  await ffmpeg(["-y", "-ss", "0.1", "-i", input, "-frames:v", "1", "-vf", "scale=320:320:force_original_aspect_ratio=decrease", frame], context);
  const meta = await sharp(await readFile(frame))
    .webp({ quality: 72 })
    .toFile(thumbnail);
  return variant("thumbnail", "thumbnail-320", thumbnail, "image/webp", meta.width, meta.height);
}

async function probe(input: string, context: ProcessContext) {
  const output = await runMediaCommand(config.FFPROBE_PATH, ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", input], {
    signal: context.signal,
    captureStdout: true,
    maxStdoutBytes: 1024 * 1024,
    onHeartbeat: context.heartbeat,
  });
  const parsed = JSON.parse(output.toString("utf8")) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(parsed.format?.duration ?? 0);
  return {
    width: video?.width ?? null,
    height: video?.height ?? null,
    durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
  };
}

function waveform(pcm: Buffer, bins: number) {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return Array<number>(bins).fill(0);
  const result: number[] = [];
  for (let bin = 0; bin < bins; bin += 1) {
    const from = Math.floor((bin * samples) / bins);
    const to = Math.max(from + 1, Math.floor(((bin + 1) * samples) / bins));
    let peak = 0;
    for (let index = from; index < to && index < samples; index += 1) peak = Math.max(peak, Math.abs(pcm.readInt16LE(index * 2)));
    result.push(Math.round((peak / 32767) * 100));
  }
  return result;
}

function createWaveformAccumulator(expectedSamples: number, bins: number) {
  const peaks = Array<number>(bins).fill(0);
  let sampleIndex = 0;
  let remainder: Buffer | null = null;
  return {
    push(chunk: Buffer) {
      const input = remainder ? Buffer.concat([remainder, chunk]) : chunk;
      const usableBytes = input.length - (input.length % 2);
      for (let offset = 0; offset < usableBytes; offset += 2) {
        const bin = Math.min(bins - 1, Math.floor((sampleIndex * bins) / expectedSamples));
        peaks[bin] = Math.max(peaks[bin]!, Math.abs(input.readInt16LE(offset)));
        sampleIndex += 1;
      }
      remainder = usableBytes === input.length ? null : input.subarray(usableBytes);
    },
    finish() {
      return peaks.map((peak) => Math.round((peak / 32767) * 100));
    },
  };
}

function variant(role: "primary" | "thumbnail", profile: string, file: string, mimeType: string, width: number | null = null, height: number | null = null, durationMs: number | null = null): OutputVariant {
  return {
    role,
    profile,
    path: file,
    mimeType,
    width: width ?? null,
    height: height ?? null,
    durationMs,
    waveform: null,
  };
}

function ffmpeg(
  args: readonly string[],
  context: ProcessContext & {
    captureStdout?: boolean;
    maxStdoutBytes?: number;
    onStdoutChunk?: (chunk: Buffer) => void;
  },
) {
  return runMediaCommand(config.FFMPEG_PATH, ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", ...args], {
    signal: context.signal,
    onHeartbeat: context.heartbeat,
    ...(context.captureStdout === undefined ? {} : { captureStdout: context.captureStdout }),
    ...(context.maxStdoutBytes === undefined ? {} : { maxStdoutBytes: context.maxStdoutBytes }),
    ...(context.onStdoutChunk === undefined ? {} : { onStdoutChunk: context.onStdoutChunk }),
  });
}

export const internals = {
  waveform,
  createWaveformAccumulator,
  imageProfiles,
  videoProfiles,
};
