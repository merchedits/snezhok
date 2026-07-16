import assert from "node:assert/strict";
import test from "node:test";

import { voiceGestureDecision, voiceGestureProgress } from "./voiceRecordingGesture";

test("voice gesture cancels left and locks upward", () => {
  assert.equal(voiceGestureDecision(-100, -20), "cancel");
  assert.equal(voiceGestureDecision(-10, -90), "lock");
  assert.equal(voiceGestureDecision(-20, -20), "holding");
});

test("dominant threshold wins for diagonal movement", () => {
  assert.equal(voiceGestureDecision(-100, -100), "lock");
  assert.deepEqual(voiceGestureProgress(-46, -39), { cancel: 0.5, lock: 0.5 });
});
