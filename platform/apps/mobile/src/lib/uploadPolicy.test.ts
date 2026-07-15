import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedUploadOffset,
  CLIENT_MAX_UPLOAD_BYTES,
  LOW_END_UPLOAD_CHUNK_BYTES,
  retryableUploadStatus,
  uploadChunkBytes,
  uploadRetryDelayMs,
  validateUploadSource,
} from "./uploadPolicy";

test("A12 upload chunks stay below the server window and one MiB heap budget", () => {
  assert.equal(uploadChunkBytes(4 * 1024 * 1024), LOW_END_UPLOAD_CHUNK_BYTES);
  assert.equal(uploadChunkBytes(256 * 1024), 256 * 1024);
  assert.equal(uploadChunkBytes(1), LOW_END_UPLOAD_CHUNK_BYTES);
});

test("upload source validation rejects empty, malformed and huge inputs", () => {
  assert.doesNotThrow(() => validateUploadSource("photo.jpg", CLIENT_MAX_UPLOAD_BYTES));
  assert.throws(() => validateUploadSource("", 1), /invalid name/);
  assert.throws(() => validateUploadSource("empty.jpg", 0), /empty or unreadable/);
  assert.throws(() => validateUploadSource("huge.bin", CLIENT_MAX_UPLOAD_BYTES + 1), /2 GB/);
});

test("resume offsets and retry policy fail closed", () => {
  assert.equal(boundedUploadOffset(80, 100), 80);
  assert.equal(boundedUploadOffset(120, 100), 100);
  assert.equal(boundedUploadOffset(Number.NaN, 100), 0);
  assert.equal(retryableUploadStatus(409), true);
  assert.equal(retryableUploadStatus(503), true);
  assert.equal(retryableUploadStatus(413), false);
  assert.deepEqual([0, 1, 2, 8].map(uploadRetryDelayMs), [0, 350, 700, 4000]);
});
