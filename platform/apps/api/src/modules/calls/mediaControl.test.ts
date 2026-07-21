import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MAX_MEDIA_CONTROL_ATTEMPTS, retryDelaySeconds, revocationTimestamp, sanitizedMediaErrorCode } from "./mediaControl.js";

test("revocation timestamp uses whole Unix seconds", () => {
  assert.equal(revocationTimestamp(1_789_000_123_999), 1_789_000_123n);
});

test("media command retries back off deterministically and stay bounded", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 20].map(retryDelaySeconds), [1, 2, 4, 8, 16, 60]);
});

test("media command retries terminate in an operator-visible dead letter", () => {
  assert.equal(MAX_MEDIA_CONTROL_ATTEMPTS, 12);
  assert.match(readFileSync(new URL("mediaControl.ts", import.meta.url), "utf8"), /status=CASE WHEN \$4 THEN 'failed' ELSE 'pending' END/);
});

test("media errors retain only a bounded machine code", () => {
  const error = Object.assign(new Error("contains private endpoint and request payload"), { code: "unavailable" });
  assert.equal(sanitizedMediaErrorCode(error), "unavailable");
  assert.equal(sanitizedMediaErrorCode(new Error("sensitive")), "error");
  assert.equal(sanitizedMediaErrorCode("sensitive"), "unknown");
});
