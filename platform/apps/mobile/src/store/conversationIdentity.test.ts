import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationSummary, UserSummary } from "@snezhok/contracts";

import { directPeer, startsRegularConversationSection, upsertConversation } from "./conversationIdentity";

const me = user("me", "Me", "me");
const oldAccount = user("old", "Anna", "anna_old");
const newAccount = user("new", "Anna", "anna_new");

test("direct conversation identity follows account id even when display names match", () => {
  assert.equal(directPeer(conversation("old-chat", [me, oldAccount]), me.id)?.id, oldAccount.id);
  assert.equal(directPeer(conversation("new-chat", [newAccount, me]), me.id)?.id, newAccount.id);
});

test("only inserts spacing at the boundary after the complete pinned block", () => {
  const saved = conversation("saved", [me], { saved: true, pinned: true });
  const pinned = conversation("pinned", [me, oldAccount], { pinned: true });
  const regular = conversation("regular", [me, newAccount]);
  const items = [saved, pinned, regular];
  assert.equal(startsRegularConversationSection(items, 1), false);
  assert.equal(startsRegularConversationSection(items, 2), true);
});

test("opening a new account chat preserves a previous account conversation", () => {
  const oldChat = conversation("old-chat", [me, oldAccount]);
  const newChat = conversation("new-chat", [me, newAccount]);
  assert.deepEqual(upsertConversation([oldChat], newChat).map((item) => item.id), ["new-chat", "old-chat"]);
});

function user(id: string, displayName: string, username: string): UserSummary {
  return { id, displayName, username, avatarUrl: null, avatarColor: "#fff", bio: "", statusText: "", presence: "offline", lastSeenAt: 0 };
}

function conversation(id: string, participants: UserSummary[], overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return { id, kind: "direct", title: participants.find((item) => item.id !== me.id)?.displayName ?? "Saved", avatarUrl: null, participants, lastMessage: null, unreadCount: 0, mentionCount: 0, muted: false, pinned: false, archived: false, saved: false, updatedAt: 0, ...overrides };
}
