import assert from "node:assert/strict";
import test from "node:test";

import {
  initialChatTimelineIndex,
  readChatTimelineMemory,
  rememberChatTimelinePosition,
  resetChatTimelineMemoryForTests,
} from "./chatTimelineMemory";

test("a new chat starts at the final message without a corrective animation", () => {
  assert.equal(initialChatTimelineIndex(["one", "two", "three"], null), 2);
});

test("a revisited chat restores its remembered visible message", () => {
  resetChatTimelineMemoryForTests();
  rememberChatTimelinePosition("chat", { anchorMessageId: "two", renderLimit: 140, atBottom: false }, 1_000);
  const remembered = readChatTimelineMemory("chat", 2_000);
  assert.equal(initialChatTimelineIndex(["one", "two", "three"], remembered), 1);
  assert.equal(remembered?.renderLimit, 140);
});

test("bottom positions and missing anchors safely resolve to the newest message", () => {
  const bottom = { anchorMessageId: "two", renderLimit: 80, atBottom: true, rememberedAt: 1 };
  const missing = { ...bottom, anchorMessageId: "missing", atBottom: false };
  assert.equal(initialChatTimelineIndex(["one", "two", "three"], bottom), 2);
  assert.equal(initialChatTimelineIndex(["one", "two", "three"], missing), 2);
});

test("stale positions expire instead of restoring obsolete history", () => {
  resetChatTimelineMemoryForTests();
  rememberChatTimelinePosition("chat", { anchorMessageId: "one", renderLimit: 80, atBottom: false }, 0);
  assert.equal(readChatTimelineMemory("chat", 2 * 60 * 60_000 + 1), null);
});
