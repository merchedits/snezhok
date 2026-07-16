import assert from "node:assert/strict";
import test from "node:test";

import {
  completeVoicePlayback,
  cycleVoicePlaybackSpeed,
  registerVoiceController,
  requestVoicePlayback,
  resetVoicePlaybackForTests,
  setVoicePlaybackQueue,
  voicePlaybackSnapshot,
} from "./voicePlaybackCoordinator";

test("starting another note pauses the current note", () => {
  resetVoicePlaybackForTests();
  const calls: string[] = [];
  registerVoiceController("s", "a", { play: () => calls.push("play-a"), pause: () => calls.push("pause-a"), setRate: () => undefined });
  registerVoiceController("s", "b", { play: () => calls.push("play-b"), pause: () => calls.push("pause-b"), setRate: () => undefined });
  requestVoicePlayback("s", "a");
  requestVoicePlayback("s", "b");
  assert.deepEqual(calls, ["play-a", "pause-a", "play-b"]);
});

test("completion requests the next voice note in stream order", () => {
  resetVoicePlaybackForTests();
  setVoicePlaybackQueue("s", ["a", "b"]);
  requestVoicePlayback("s", "a");
  completeVoicePlayback("s", "a");
  assert.equal(voicePlaybackSnapshot().requestedKey, "s:b");
  completeVoicePlayback("s", "b");
  assert.equal(voicePlaybackSnapshot().requestedKey, null);
});

test("playback speed cycles through Telegram-style values", () => {
  resetVoicePlaybackForTests();
  assert.equal(cycleVoicePlaybackSpeed(), 1.5);
  assert.equal(cycleVoicePlaybackSpeed(), 2);
  assert.equal(cycleVoicePlaybackSpeed(), 1);
});
