import assert from "node:assert/strict";
import test from "node:test";
import { TrackSource } from "livekit-server-sdk";

import { expectedCallMatches, localLeaveEndsSession, voiceChannelGrantPolicy } from "./semantics.js";
import { allowedPublishSources, canEndCall, canEndCallWithAccess } from "./routes.js";

test("a local leave ends only bilateral direct calls", () => {
  assert.equal(localLeaveEndsSession("conversation", "direct"), true);
  assert.equal(localLeaveEndsSession("conversation", "group"), false);
  assert.equal(localLeaveEndsSession("channel", null), false);
});

test("voice channel capabilities are independently derived from effective permissions", () => {
  assert.deepEqual(voiceChannelGrantPolicy([]), { canConnect: false, canSpeak: false, canUseVideo: false, canShareScreen: false });
  assert.deepEqual(voiceChannelGrantPolicy(["connect", "speak"]), { canConnect: true, canSpeak: true, canUseVideo: false, canShareScreen: false });
  assert.deepEqual(voiceChannelGrantPolicy(["connect", "video", "screen_share"]), { canConnect: true, canSpeak: false, canUseVideo: true, canShareScreen: true });
});

test("LiveKit tokens expose only the effective channel media sources", () => {
  assert.deepEqual(allowedPublishSources({ streamKind: "channel", serverPermissions: ["connect", "speak"] }), [TrackSource.MICROPHONE]);
  assert.deepEqual(allowedPublishSources({ streamKind: "channel", serverPermissions: ["connect", "video", "screen_share"] }), [TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]);
  assert.deepEqual(allowedPublishSources({ streamKind: "channel", serverPermissions: ["connect"] }), []);
});

test("participant leave and moderator end-for-all remain separate capabilities", () => {
  assert.equal(canEndCall("member", "starter", "member"), false);
  assert.equal(canEndCall("starter", "starter", "member"), true);
  assert.equal(canEndCall("moderator", "starter", "moderator"), true);
  assert.equal(canEndCallWithAccess("custom", "starter", { streamKind: "channel", memberRole: "member", serverPermissions: ["move_members"] }), true);
  assert.equal(canEndCallWithAccess("member", "starter", { streamKind: "channel", memberRole: "member", serverPermissions: ["connect"] }), false);
});

test("notification answers are bound to the exact active call", () => {
  assert.equal(expectedCallMatches("call-1", "call-1"), true);
  assert.equal(expectedCallMatches("call-2", "call-1"), false);
  assert.equal(expectedCallMatches(undefined, "call-1"), false);
  assert.equal(expectedCallMatches(undefined, undefined), true);
});
