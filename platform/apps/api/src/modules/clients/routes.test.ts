import assert from "node:assert/strict";
import test from "node:test";
import { parseSingleRange } from "./routes.js";

test("Android APK downloads accept resumable byte ranges", () => {
  assert.deepEqual(parseSingleRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseSingleRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseSingleRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(parseSingleRange("bytes=100-", 100), "invalid");
  assert.equal(parseSingleRange("bytes=1-2,4-5", 100), "invalid");
});
