import assert from "node:assert/strict";
import test from "node:test";

import { voiceWaveformBars } from "./voiceWaveform";

test("downsamples waveform peaks and keeps bars visible", () => {
  assert.deepEqual(voiceWaveformBars([0, 20, 100, 40], 2), [7, 20]);
});

test("clamps malformed waveform values", () => {
  assert.deepEqual(voiceWaveformBars([-20, Number.NaN, 140], 3), [4, 4, 20]);
});

test("provides a stable visual placeholder while audio processing finishes", () => {
  const first = voiceWaveformBars(undefined, 12);
  assert.equal(first.length, 12);
  assert.deepEqual(first, voiceWaveformBars([], 12));
});
