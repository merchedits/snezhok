import assert from "node:assert/strict";
import test from "node:test";

import {
  audioSessionPurpose,
  claimAudioSession,
  ownsAudioSession,
  releaseAudioSession,
  resetAudioSessionOwnershipForTests,
  runAudioSessionOperation,
} from "./audioSessionOwnership";

test.beforeEach(async () => resetAudioSessionOwnershipForTests());

test("call preempts voice playback and stale cleanup cannot clear the call", async () => {
  let playbackPreempted = 0;
  const playback = claimAudioSession("voice-playback", "voice:one", () => { playbackPreempted += 1; });
  assert.ok(playback);
  const call = claimAudioSession("call", "call:one");
  assert.ok(call);
  assert.equal(playbackPreempted, 1);
  assert.equal(ownsAudioSession(playback), false);
  assert.equal(ownsAudioSession(call), true);

  let staleCleanup = 0;
  assert.equal(await releaseAudioSession(playback, async () => { staleCleanup += 1; }), false);
  assert.equal(staleCleanup, 0);
  assert.equal(audioSessionPurpose(), "call");
});

test("lower-priority media cannot steal an active call", () => {
  const call = claimAudioSession("call", "call:one");
  assert.ok(call);
  assert.equal(claimAudioSession("voice-recording", "recording:one"), null);
  assert.equal(claimAudioSession("voice-playback", "voice:one"), null);
  assert.equal(ownsAudioSession(call), true);
});

test("native audio mutations stay ordered and stale owners are skipped", async () => {
  const events: string[] = [];
  const playback = claimAudioSession("voice-playback", "voice:one");
  assert.ok(playback);
  const first = runAudioSessionOperation(playback, async () => {
    events.push("playback-start");
    await Promise.resolve();
    events.push("playback-end");
  });
  const call = claimAudioSession("call", "call:one");
  assert.ok(call);
  const second = runAudioSessionOperation(call, async () => { events.push("call-configured"); });
  await Promise.all([first, second]);
  assert.deepEqual(events, ["call-configured"]);
});

test("release performs cleanup before making the session available", async () => {
  const recording = claimAudioSession("voice-recording", "recording:one");
  assert.ok(recording);
  const events: string[] = [];
  assert.equal(await releaseAudioSession(recording, async () => { events.push("cleanup"); }), true);
  assert.deepEqual(events, ["cleanup"]);
  assert.equal(audioSessionPurpose(), null);
  assert.ok(claimAudioSession("voice-playback", "voice:two"));
});
