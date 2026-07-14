import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import { markMessageDeleted, mergeMessages, reconcilePinnedMessages, visibleMessages } from "./messageReconciliation";

function message(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    clientId: null,
    streamId: "stream",
    streamKind: "conversation",
    sequence: 1,
    sender: { id: "sender", username: "sender", displayName: "Sender", avatarUrl: null, avatarColor: "#fff", bio: "", statusText: "", presence: "online", lastSeenAt: 0 },
    kind: "text",
    text: "hello",
    replyTo: null,
    forwardedFrom: null,
    attachments: [],
    reactions: [],
    createdAt: 1,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

test("replaces an optimistic placeholder with its realtime server message", () => {
  const clientId = "11111111-1111-4111-8111-111111111111";
  const optimistic = message(clientId, { clientId, pending: true });
  const saved = message("22222222-2222-4222-8222-222222222222", { clientId, sequence: 9, createdAt: 9 });
  assert.deepEqual(mergeMessages([optimistic], [saved]), [saved]);
});

test("does not duplicate when the HTTP response follows the realtime event", () => {
  const clientId = "11111111-1111-4111-8111-111111111111";
  const saved = message("22222222-2222-4222-8222-222222222222", { clientId, sequence: 9, createdAt: 9 });
  assert.deepEqual(mergeMessages([saved], [saved]), [saved]);
});

test("reconciles cached legacy optimistic messages whose clientId is absent", () => {
  const clientId = "11111111-1111-4111-8111-111111111111";
  const optimistic = message(clientId, { failed: true });
  delete optimistic.clientId;
  const saved = message("22222222-2222-4222-8222-222222222222", { clientId, sequence: 9, createdAt: 9 });
  assert.deepEqual(mergeMessages([optimistic], [saved]), [saved]);
});

test("reconciles realtime deletion without removing message order", () => {
  const first = message("first", { sequence: 1 });
  const second = message("second", { sequence: 2, text: "remove", editedAt: 5, pinnedAt: 6 });
  const result = markMessageDeleted([first, second], second.id, 10);
  assert.equal(result.length, 2);
  assert.deepEqual(result[1], { ...second, text: "", deletedAt: 10, editedAt: null, pinnedAt: null });
});

test("Telegram-style history hides deletion tombstones", () => {
  const live = message("live");
  const deleted = message("deleted", { deletedAt: 10 });
  assert.deepEqual(visibleMessages([deleted, live]), [live]);
});

test("pinned endpoint clears stale cached pins while preserving canonical ones", () => {
  const stale = message("stale", { pinnedAt: 5 });
  const current = message("current", { pinnedAt: 10 });
  const result = reconcilePinnedMessages([stale], [current]);
  assert.equal(result.find((item) => item.id === stale.id)?.pinnedAt, null);
  assert.equal(result.find((item) => item.id === current.id)?.pinnedAt, 10);
});
