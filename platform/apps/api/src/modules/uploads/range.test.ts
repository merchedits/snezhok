import assert from "node:assert/strict";
import test from "node:test";

import { effectiveRangeHeader, parseRange } from "./routes.js";

test("media ranges support bounded, open and suffix requests", () => {
  assert.deepEqual(parseRange("bytes=0-1023", 10_000), { start: 0, end: 1023 });
  assert.deepEqual(parseRange("bytes=9000-", 10_000), { start: 9000, end: 9999 });
  assert.deepEqual(parseRange("bytes=-512", 10_000), { start: 9488, end: 9999 });
  assert.equal(parseRange("bytes=1-2,5-6", 10_000), "invalid");
});

test("If-Range only resumes an immutable matching representation", () => {
  const etag = `"${"a".repeat(64)}"`;
  assert.equal(effectiveRangeHeader("bytes=100-", undefined, etag), "bytes=100-");
  assert.equal(effectiveRangeHeader("bytes=100-", etag, etag), "bytes=100-");
  assert.equal(effectiveRangeHeader("bytes=100-", `"stale"`, etag), undefined);
});
