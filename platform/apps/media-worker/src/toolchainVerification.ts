import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { MediaJob } from "./types.js";

// This executable is intentionally run while the production media-worker image
// is being built. Keep configuration in test mode: it verifies the exact native
// codecs in the image without requiring database credentials or touching storage.
process.env.NODE_ENV = "test";
process.env.FFMPEG_PATH ??= "ffmpeg";
process.env.FFPROBE_PATH ??= "ffprobe";
process.env.MEDIA_COMMAND_TIMEOUT_MS ??= "120000";

const directory = await mkdtemp(path.join(os.tmpdir(), "snezhok-media-toolchain-"));
try {
  const { processMedia } = await import("./processors.js");
  const context = { signal: new AbortController().signal, heartbeat: async () => undefined };

  const silentInput = path.join(directory, "silent.wav");
  await command(process.env.FFMPEG_PATH, [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "1",
    "-c:a", "pcm_s16le", silentInput,
  ]);
  const voiceDirectory = path.join(directory, "voice");
  await mkdir(voiceDirectory);
  const voiceOutputs = await processMedia(mediaJob("audio", "voice", "audio/wav"), silentInput, voiceDirectory, context);
  const voice = voiceOutputs.find((output) => output.role === "primary");
  assert(voice, "voice processing did not produce a primary output");
  assert.equal(voice.mimeType, "audio/ogg");
  assert.equal(voice.waveform?.length, 100);
  assert(voice.waveform?.every((value) => value === 0), "digital silence produced false waveform activity");
  const voiceProbe = await probe(voice.path);
  const voiceStream = voiceProbe.streams.find((stream) => stream.codec_type === "audio");
  assert.equal(voiceStream?.codec_name, "opus");
  assert.equal(voiceStream?.sample_rate, "48000");
  assert.equal(voiceStream?.channels, 1);

  const videoInput = path.join(directory, "portrait-input.mp4");
  await command(process.env.FFMPEG_PATH, [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "1.5", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", videoInput,
  ]);
  const videoDirectory = path.join(directory, "video");
  await mkdir(videoDirectory);
  const videoOutputs = await processMedia(mediaJob("video", "standard", "video/mp4"), videoInput, videoDirectory, context);
  const video = videoOutputs.find((output) => output.role === "primary");
  const thumbnail = videoOutputs.find((output) => output.role === "thumbnail");
  assert(video && thumbnail, "video processing did not produce both primary and thumbnail outputs");
  assert.deepEqual([video.width, video.height], [720, 1280], "portrait aspect ratio was not preserved");
  assert((thumbnail.width ?? 0) <= 320 && (thumbnail.height ?? 0) <= 320, "video thumbnail exceeds its bound");
  const thumbnailMetadata = await sharp(thumbnail.path).metadata();
  assert.equal(thumbnailMetadata.format, "webp");
  const videoProbe = await probe(video.path);
  const videoStream = videoProbe.streams.find((stream) => stream.codec_type === "video");
  const audioStream = videoProbe.streams.find((stream) => stream.codec_type === "audio");
  assert.equal(videoStream?.codec_name, "h264");
  assert.equal(videoStream?.pix_fmt, "yuv420p");
  assert.equal(audioStream?.codec_name, "aac");
  const mp4 = await readFile(video.path);
  const moov = mp4.indexOf(Buffer.from("moov"));
  const mdat = mp4.indexOf(Buffer.from("mdat"));
  assert(moov >= 0 && mdat >= 0 && moov < mdat, "MP4 fast-start metadata is not before media data");

  process.stdout.write("Snezhok media toolchain verification passed (voice/Opus, waveform, video/H.264, AAC, thumbnail, aspect ratio, fast-start).\n");
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function mediaJob(kind: "audio" | "video", purpose: "voice" | "standard", mimeType: string): MediaJob {
  return {
    id: crypto.randomUUID(),
    attachmentId: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    profile: "auto",
    purpose,
    operation: "standard",
    sourceStorageKeys: [],
    kind,
    originalMimeType: mimeType,
    originalStorageKey: `objects/00/${"0".repeat(64)}`,
    originalFilename: kind === "video" ? "input.mp4" : "input.wav",
    originalBytes: 1_024,
    attempts: 1,
    maxAttempts: 4,
  };
}

interface ProbeResult {
  streams: Array<{
    codec_type?: string;
    codec_name?: string;
    pix_fmt?: string;
    sample_rate?: string;
    channels?: number;
  }>;
}

async function probe(file: string): Promise<ProbeResult> {
  const output = await command(process.env.FFPROBE_PATH!, [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt,sample_rate,channels", "-of", "json", file,
  ], true);
  return JSON.parse(output.toString("utf8")) as ProbeResult;
}

function command(executable: string, args: readonly string[], capture = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { shell: false, windowsHide: true, stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    const timeout = setTimeout(() => child.kill("SIGKILL"), 120_000);
    timeout.unref();
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) child.kill("SIGKILL");
      else stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`${executable} failed (${code ?? signal}): ${Buffer.concat(stderr).toString("utf8").slice(-4_000)}`));
      else resolve(Buffer.concat(stdout));
    });
  });
}
