import assert from "node:assert/strict";
import test from "node:test";

import { replaceImageExtension, resizeForLongEdge } from "./mediaCompressionPolicy";

test("prepared photos use a truthful JPEG filename", () => {
  assert.equal(replaceImageExtension("camera.HEIC", "jpg"), "camera.jpg");
  assert.equal(replaceImageExtension("photo", "jpg"), "photo.jpg");
});

test("normal photo resize follows the real long edge and never upscales", () => {
  assert.deepEqual(resizeForLongEdge(4_000, 3_000, 1_600), { width: 1_600 });
  assert.deepEqual(resizeForLongEdge(3_000, 4_000, 1_600), { height: 1_600 });
  assert.equal(resizeForLongEdge(1_200, 900, 1_600), null);
});
