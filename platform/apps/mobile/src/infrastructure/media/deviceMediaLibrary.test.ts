import assert from "node:assert/strict";
import test from "node:test";

import { kindFromMimeType, mimeTypeFor } from "./mediaNormalization";

test("device media normalization classifies original files without UI policy", () => {
  assert.equal(kindFromMimeType("image/jpeg"), "image");
  assert.equal(kindFromMimeType("audio/ogg"), "audio");
  assert.equal(kindFromMimeType(undefined), "document");
});

test("device media normalization retains common Android image and video MIME types", () => {
  assert.equal(mimeTypeFor("portrait.heic", false), "image/heic");
  assert.equal(mimeTypeFor("clip.mov", true), "video/quicktime");
  assert.equal(mimeTypeFor("camera.jpg", false), "image/jpeg");
});
