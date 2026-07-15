import assert from "node:assert/strict";
import test from "node:test";
import { summarizeFrameDeltas } from "./framePacing";

test("frame pacing reports 60 Hz motion and isolates janky frames", () => {
  const result = summarizeFrameDeltas([16.7, 16.6, 16.8, 33.4]);
  assert.equal(result.frames, 4);
  assert.equal(result.jankyFrames, 1);
  assert.ok(result.averageFps > 45 && result.averageFps < 50);
  assert.equal(result.p95FrameMs, 33.4);
});

test("frame pacing ignores invalid scheduler gaps", () => {
  assert.deepEqual(summarizeFrameDeltas([0, -1, Number.NaN, 5_000]), { frames: 0, averageFps: 0, p95FrameMs: 0, jankyFrames: 0 });
});
