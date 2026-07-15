import assert from "node:assert/strict";
import test from "node:test";

import { MEDIA_LIMITS, validateOutputVariants, validateSourceMetadata } from "./mediaLimits.js";

test("source metadata rejects decompression bombs and unbounded recordings", () => {
  assert.doesNotThrow(() => validateSourceMetadata({ kind: "video", purpose: "standard" }, { width: 1920, height: 1080, durationMs: 60_000 }));
  assert.throws(() => validateSourceMetadata({ kind: "image", purpose: "standard" }, { width: 8_000, height: 8_000, durationMs: null }), /dimensions/);
  assert.throws(() => validateSourceMetadata({ kind: "audio", purpose: "voice" }, { width: null, height: null, durationMs: MEDIA_LIMITS.maxVoiceDurationMs + 1 }), /duration/);
});

test("output variants require one bounded primary and thumbnail", () => {
  const primary = { role: "primary" as const, profile: "auto", path: "main.webp", mimeType: "image/webp", width: 1280, height: 720, durationMs: null, waveform: null };
  const thumbnail = { role: "thumbnail" as const, profile: "thumbnail-320", path: "thumb.webp", mimeType: "image/webp", width: 320, height: 180, durationMs: null, waveform: null };
  assert.doesNotThrow(() => validateOutputVariants({ kind: "image", purpose: "standard" }, [primary, thumbnail]));
  assert.throws(() => validateOutputVariants({ kind: "image", purpose: "standard" }, [primary]), /thumbnail/);
  assert.throws(() => validateOutputVariants({ kind: "image", purpose: "standard" }, [primary, { ...thumbnail, width: 640 }]), /Thumbnail/);
});
