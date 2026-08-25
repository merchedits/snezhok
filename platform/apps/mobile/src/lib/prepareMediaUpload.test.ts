import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { replaceImageExtension, resizeForLongEdge } from "./mediaCompressionPolicy";

const preparationSource = readFileSync(new URL("./prepareMediaUpload.ts", import.meta.url), "utf8");
const nativeCompressorSource = readFileSync(new URL("../../modules/snezhok-media-compressor/android/src/main/java/xyz/merchedits/snezhok/media/SnezhokMediaCompressorModule.kt", import.meta.url), "utf8");

test("prepared photos use a truthful JPEG filename", () => {
  assert.equal(replaceImageExtension("camera.HEIC", "jpg"), "camera.jpg");
  assert.equal(replaceImageExtension("photo", "jpg"), "photo.jpg");
});

test("normal photo resize follows the real long edge and never upscales", () => {
  assert.deepEqual(resizeForLongEdge(4_000, 3_000, 1_600), { width: 1_600 });
  assert.deepEqual(resizeForLongEdge(3_000, 4_000, 1_600), { height: 1_600 });
  assert.equal(resizeForLongEdge(1_200, 900, 1_600), null);
});

test("Android normal sends use sampled native decoding with a safe Expo fallback", () => {
  assert.match(preparationSource, /compressImageNative/);
  assert.match(preparationSource, /manipulateAsync/);
  assert.match(nativeCompressorSource, /inSampleSize = sampleSize/);
  assert.match(nativeCompressorSource, /ExifInterface\.TAG_ORIENTATION/);
  assert.match(nativeCompressorSource, /Bitmap\.CompressFormat\.JPEG/);
});
