import assert from "node:assert/strict";
import test from "node:test";

import { appendBounded } from "./boundedRingBuffer";

test("bounded diagnostics append in place and retain newest events", () => {
  const events = [1, 2];
  const identity = events;
  appendBounded(events, 3, 2);
  assert.equal(events, identity);
  assert.deepEqual(events, [2, 3]);
});
