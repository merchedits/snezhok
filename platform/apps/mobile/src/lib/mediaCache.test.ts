import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MEDIA_CACHE_LIMIT_MB, formatStorageBytes, MEDIA_CACHE_LIMITS_MB } from "./mediaCachePolicy";

test("A12 media cache defaults to a bounded fraction of common device storage", () => {
  assert.equal(DEFAULT_MEDIA_CACHE_LIMIT_MB, 256);
  assert.deepEqual(MEDIA_CACHE_LIMITS_MB, [128, 256, 512]);
});

test("storage usage is compact and stable", () => {
  assert.equal(formatStorageBytes(0), "0 MB");
  assert.equal(formatStorageBytes(512 * 1024), "0.5 MB");
  assert.equal(formatStorageBytes(1536 * 1024 * 1024), "1.5 GB");
});
