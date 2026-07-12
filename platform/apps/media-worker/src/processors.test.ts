import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

test("video profiles map to bounded 720p, 1080p and 2160p derivatives", () => {
  assert.equal(internals.videoProfiles["data-saver"].height, 720);
  assert.equal(internals.videoProfiles.auto.height, 1080);
  assert.equal(internals.videoProfiles.high.height, 2160);
});

test("waveform produces stable normalized bins", () => {
  const pcm = Buffer.alloc(400);
  for (let index = 0; index < 200; index += 1) pcm.writeInt16LE(index < 100 ? 32767 : 0, index * 2);
  const result = internals.waveform(pcm, 4);
  assert.deepEqual(result, [100, 100, 0, 0]);
});

test("image processing auto-orients and emits metadata-free primary and thumbnail variants", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "snezhok-media-test-"));
  try {
    const input = path.join(directory, "input.jpg");
    await sharp({ create: { width: 40, height: 20, channels: 3, background: "#ef4444" } }).withMetadata({ orientation: 6 }).jpeg().toFile(input);
    const output = await processMedia({ id: crypto.randomUUID(), attachmentId: crypto.randomUUID(), ownerId: crypto.randomUUID(), profile: "auto", purpose: "standard", kind: "image", originalMimeType: "image/jpeg", originalStorageKey: "objects/00/" + "0".repeat(64), originalFilename: "input.jpg", attempts: 1, maxAttempts: 4 }, input, directory, { signal: new AbortController().signal, heartbeat: async () => undefined });
    assert.deepEqual(output.map((item) => item.role), ["primary", "thumbnail"]);
    const inspected = sharp(await readFile(output[0]!.path)); const metadata = await inspected.metadata(); inspected.destroy();
    assert.equal(metadata.width, 20); assert.equal(metadata.height, 40);
    assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined); assert.equal(metadata.xmp, undefined);
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
