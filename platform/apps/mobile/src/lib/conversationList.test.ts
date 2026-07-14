import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationSummary } from "@snezhok/contracts";

import { visibleConversationSummaries } from "./conversationList";

test("chat list preserves every active conversation, including empty ones", () => {
  const saved = conversation("saved", "Saved", { saved: true, updatedAt: 1 });
  const active = conversation("snow", "Snow", { lastMessage: null, updatedAt: 2 });
  const archived = conversation("old", "Old", { archived: true, updatedAt: 3 });

  assert.deepEqual(
    visibleConversationSummaries([active, archived, saved], "", (item) => item.title).map((item) => item.id),
    ["saved", "snow"],
  );
});

test("chat search matches titles without dropping unrelated active state", () => {
  const snow = conversation("snow", "Снежик Труман");
  const other = conversation("other", "snezchik");
  assert.deepEqual(visibleConversationSummaries([other, snow], "снеж", (item) => item.title).map((item) => item.id), ["snow"]);
});

function conversation(id: string, title: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id,
    kind: "direct",
    title,
    avatarUrl: null,
    participants: [],
    lastMessage: null,
    unreadCount: 0,
    mentionCount: 0,
    muted: false,
    pinned: false,
    archived: false,
    saved: false,
    updatedAt: 0,
    ...overrides,
  };
}
