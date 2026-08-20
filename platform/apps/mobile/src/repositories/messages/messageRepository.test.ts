import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import { emptyMessageRepository, messagesForStream, reconcileMessageProjection } from "./messageRepository";

test("repository reconciles optimistic identity and rejects a stale durable revision", () => {
  const optimistic = message("10000000-0000-4000-8000-000000000001", { clientId: "10000000-0000-4000-8000-000000000001", pending: true });
  const first = reconcileMessageProjection({ stream: [optimistic] }, {}, emptyMessageRepository);
  const saved = message("20000000-0000-4000-8000-000000000001", { clientId: optimistic.id, revision: 3, text: "saved" });
  const second = reconcileMessageProjection({ stream: [saved] }, first.messages, first.repository);
  assert.equal(second.repository.byId[optimistic.id], undefined);
  assert.equal(second.repository.idByClientId[optimistic.id], saved.id);
  const stale = { ...saved, revision: 2, text: "stale" };
  const third = reconcileMessageProjection({ stream: [stale] }, second.messages, second.repository);
  assert.equal(messagesForStream(third.repository, "stream")[0]?.text, "saved");
});

test("a one-stream update preserves entities and arrays in unrelated streams", () => {
  const first = message("10000000-0000-4000-8000-000000000001", { streamId: "first" });
  const second = message("10000000-0000-4000-8000-000000000002", { streamId: "second" });
  const before = reconcileMessageProjection({ first: [first], second: [second] }, {}, emptyMessageRepository);
  const updated = { ...first, revision: 2, text: "updated" };
  const after = reconcileMessageProjection({ ...before.messages, first: [updated] }, before.messages, before.repository);
  assert.equal(after.messages.second, before.messages.second);
  assert.equal(after.repository.byId[second.id], second);
});

function message(id: string, patch: Partial<Message> = {}): Message {
  return {
    id, streamId: "stream", streamKind: "conversation", sequence: 1,
    sender: { id: "30000000-0000-4000-8000-000000000001", username: "owner", displayName: "Owner", avatarUrl: null, avatarColor: "violet", bio: "", statusText: "", presence: "online", lastSeenAt: 1 },
    kind: "text", text: "message", replyTo: null, attachments: [], reactions: [], createdAt: 1, editedAt: null, deletedAt: null, pinnedAt: null,
    ...patch,
  };
}
