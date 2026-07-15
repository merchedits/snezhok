import assert from "node:assert/strict";
import test from "node:test";

import { voiceWaveformBars, voiceWaveformPath } from "./voiceWaveform";

test("downsamples normalized waveform peaks into the requested dense bar count", () => {
  assert.deepEqual(voiceWaveformBars([0, 20, 100, 40], 2), [8, 20]);
});

test("preserves digital silence at the minimum visible height", () => {
  assert.deepEqual(voiceWaveformBars([0, 0, 0, 0], 4), [4, 4, 4, 4]);
});

test("normalizes quiet speech without amplifying zero samples", () => {
  assert.deepEqual(voiceWaveformBars([0, 4, 8], 3), [4, 12, 20]);
});

test("clamps malformed waveform values", () => {
  assert.deepEqual(voiceWaveformBars([-20, Number.NaN, 140], 3), [4, 4, 20]);
});

test("upsamples short and placeholder waveforms to a stable dense bar count", () => {
  const supplied = voiceWaveformBars([0, 100], 5);
  assert.deepEqual(supplied, [4, 8, 12, 16, 20]);

  const first = voiceWaveformBars(undefined, 48);
  assert.equal(first.length, 48);
  assert.deepEqual(first, voiceWaveformBars([], 48));
});

test("builds one SVG path with a stroke for every bar", () => {
  const path = voiceWaveformPath([4, 20, 4], 12, 24, 2);
  assert.equal(path, "M1 10V14 M6 2V22 M11 10V14");
  assert.equal(voiceWaveformPath([], 12), "");
});
