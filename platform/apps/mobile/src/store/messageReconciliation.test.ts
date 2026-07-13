import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import { mergeMessages } from "./messageReconciliation";

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
