import assert from "node:assert/strict";
import test from "node:test";

import { mediaUploadLimits, validateDetectedMedia, validateUploadDeclaration } from "./mediaValidation.js";

test("media declarations enforce per-kind limits before allocating storage", () => {
  assert.doesNotThrow(() => validateUploadDeclaration({ kind: "image", purpose: "standard", mimeType: "image/jpeg", filename: "photo.jpg", bytes: mediaUploadLimits.image }, 2 ** 31));
  assert.throws(() => validateUploadDeclaration({ kind: "image", purpose: "standard", mimeType: "image/jpeg", filename: "huge.jpg", bytes: mediaUploadLimits.image + 1 }, 2 ** 31), /100 MB/);
  assert.throws(() => validateUploadDeclaration({ kind: "audio", purpose: "standard", mimeType: "audio/ogg", filename: "empty.ogg", bytes: 0 }, 2 ** 31), /at least one byte/);
});

test("declared and detected media families must match the requested operation", () => {
  assert.throws(() => validateUploadDeclaration({ kind: "image", purpose: "standard", mimeType: "application/x-msdownload", filename: "fake.jpg", bytes: 10 }, 1_000), /declared file type/);
  assert.throws(() => validateDetectedMedia("video", "standard", "image/png"), /detected file type/);
  assert.doesNotThrow(() => validateDetectedMedia("audio", "voice", "video/mp4"));
  assert.doesNotThrow(() => validateDetectedMedia("document", "standard", "application/octet-stream"));
});

test("filenames cannot smuggle path or response-header delimiters", () => {
  assert.throws(() => validateUploadDeclaration({ kind: "document", purpose: "standard", mimeType: "application/pdf", filename: "../report.pdf", bytes: 10 }, 1_000), /Filename/);
  assert.throws(() => validateUploadDeclaration({ kind: "document", purpose: "standard", mimeType: "application/pdf", filename: "bad\r\n.pdf", bytes: 10 }, 1_000), /Filename/);
});
