import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { internals, processMedia } from "./processors.js";

test("image profiles use the documented size and quality bounds", () => {
  assert.deepEqual(internals.imageProfiles["data-saver"], { size: 1280, quality: 72 });
  assert.deepEqual(internals.imageProfiles.auto, { size: 2560, quality: 82 });
  assert.deepEqual(internals.imageProfiles.high, { size: 3840, quality: 90 });
});

test("video profiles use Telegram-style long-edge bounds and constrained rates", () => {
  assert.deepEqual(internals.videoProfiles["data-saver"], { maxDimension: 854, crf: 27, maxRate: "900k", bufferSize: "1800k", audio: "64k" });
  assert.deepEqual(internals.videoProfiles.auto, { maxDimension: 1280, crf: 24, maxRate: "1800k", bufferSize: "3600k", audio: "96k" });
  assert.deepEqual(internals.videoProfiles.high, { maxDimension: 1920, crf: 22, maxRate: "3500k", bufferSize: "7000k", audio: "128k" });
});

test("waveform produces stable normalized bins", () => {
  const pcm = Buffer.alloc(400);
  for (let index = 0; index < 200; index += 1) pcm.writeInt16LE(index < 100 ? 32767 : 0, index * 2);
  const result = internals.waveform(pcm, 4);
  assert.deepEqual(result, [100, 100, 0, 0]);
});

test("streaming waveform is chunk-boundary safe and uses constant memory", () => {
  const pcm = Buffer.alloc(400);
  for (let index = 0; index < 200; index += 1) pcm.writeInt16LE(index < 100 ? 32767 : 0, index * 2);
  const accumulator = internals.createWaveformAccumulator(200, 4);
  accumulator.push(pcm.subarray(0, 37));
  accumulator.push(pcm.subarray(37, 211));
  accumulator.push(pcm.subarray(211));
  assert.deepEqual(accumulator.finish(), [100, 100, 0, 0]);
});

test("digital silence remains silent instead of being rendered as false activity", () => {
  const pcm = Buffer.alloc(16_000);
  assert.deepEqual(internals.waveform(pcm, 8), Array<number>(8).fill(0));
  const accumulator = internals.createWaveformAccumulator(8_000, 8);
  accumulator.push(pcm.subarray(0, 1));
  accumulator.push(pcm.subarray(1, 7_999));
  accumulator.push(pcm.subarray(7_999));
  assert.deepEqual(accumulator.finish(), Array<number>(8).fill(0));
});

test("image processing auto-orients and emits metadata-free primary and thumbnail variants", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "snezhok-media-test-"));
  try {
    const input = path.join(directory, "input.jpg");
    await sharp({ create: { width: 40, height: 20, channels: 3, background: "#ef4444" } }).withMetadata({ orientation: 6 }).jpeg().toFile(input);
    const output = await processMedia({ id: crypto.randomUUID(), attachmentId: crypto.randomUUID(), ownerId: crypto.randomUUID(), profile: "auto", purpose: "standard", operation: "standard", sourceStorageKeys: [], kind: "image", originalMimeType: "image/jpeg", originalStorageKey: "objects/00/" + "0".repeat(64), originalFilename: "input.jpg", originalBytes: 1_024, attempts: 1, maxAttempts: 4 }, input, directory, { signal: new AbortController().signal, heartbeat: async () => undefined });
    assert.deepEqual(output.map((item) => item.role), ["primary", "thumbnail"]);
    const inspected = sharp(await readFile(output[0]!.path)); const metadata = await inspected.metadata(); inspected.destroy();
    assert.equal(metadata.width, 20); assert.equal(metadata.height, 40);
    assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined); assert.equal(metadata.xmp, undefined);
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("color hunt processing turns nine photos into one 3 by 3 image", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "snezhok-collage-test-"));
  try {
    const inputs = await Promise.all(Array.from({ length: 9 }, async (_, index) => {
      const input = path.join(directory, `source-${index}.png`);
      await sharp({ create: { width: 24 + index, height: 40 - index, channels: 3, background: { r: index * 20, g: 80, b: 200 } } }).png().toFile(input);
      return input;
    }));
    const output = await processMedia({ id: crypto.randomUUID(), attachmentId: crypto.randomUUID(), ownerId: crypto.randomUUID(), profile: "high", purpose: "standard", operation: "color-collage", sourceStorageKeys: [], kind: "image", originalMimeType: "image/webp", originalStorageKey: null, originalFilename: "collage.webp", originalBytes: 0, attempts: 1, maxAttempts: 4 }, "", directory, { signal: new AbortController().signal, heartbeat: async () => undefined, collageInputs: inputs });
    assert.deepEqual(output.map((item) => item.role), ["primary", "thumbnail"]);
    assert.deepEqual([output[0]?.width, output[0]?.height], [1080, 1080]);
    assert.equal(output[0]?.mimeType, "image/png");
    assert.deepEqual([output[1]?.width, output[1]?.height], [320, 320]);
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("corrupt images fail closed without publishing a primary variant", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "snezhok-corrupt-image-test-"));
  try {
    const input = path.join(directory, "corrupt.jpg");
    await writeFile(input, Buffer.from("not an image"));
    await assert.rejects(
      processMedia(imageJob(), input, directory, testContext()),
      /unsupported image format|Input buffer contains unsupported image format|corrupt/i,
    );
    await assert.rejects(access(path.join(directory, "primary.webp")));
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("oversized visual dimensions are rejected before transcoding", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "snezhok-oversized-image-test-"));
  try {
    const input = path.join(directory, "oversized.png");
    await sharp({ create: { width: 8_193, height: 1, channels: 3, background: "#ffffff" } }).png().toFile(input);
    await assert.rejects(processMedia(imageJob(), input, directory, testContext()), /dimensions.*processing limit/i);
    await assert.rejects(access(path.join(directory, "primary.webp")));
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("a corrupt color-hunt source cannot produce a partial collage", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "snezhok-corrupt-collage-test-"));
  try {
    const inputs = await Promise.all(Array.from({ length: 9 }, async (_, index) => {
      const input = path.join(directory, `source-${index}.png`);
      if (index === 7) await writeFile(input, Buffer.from("corrupt"));
      else await sharp({ create: { width: 24, height: 40, channels: 3, background: "#7b4dff" } }).png().toFile(input);
      return input;
    }));
    await assert.rejects(
      processMedia(collageJob(), "", directory, { ...testContext(), collageInputs: inputs }),
      /unsupported image format|Input buffer contains unsupported image format|corrupt/i,
    );
    await assert.rejects(access(path.join(directory, "color-collage.png")));
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

function imageJob() {
  return {
    id: crypto.randomUUID(), attachmentId: crypto.randomUUID(), ownerId: crypto.randomUUID(), profile: "auto" as const,
    purpose: "standard" as const, operation: "standard" as const, sourceStorageKeys: [], kind: "image" as const,
    originalMimeType: "image/jpeg", originalStorageKey: `objects/00/${"0".repeat(64)}`, originalFilename: "input.jpg",
    originalBytes: 1_024, attempts: 1, maxAttempts: 4,
  };
}

function collageJob() {
  return {
    ...imageJob(), profile: "high" as const, operation: "color-collage" as const, originalMimeType: "image/webp",
    originalStorageKey: null, originalFilename: "collage.webp", originalBytes: 0,
  };
}

function testContext() {
  return { signal: new AbortController().signal, heartbeat: async () => undefined };
}
