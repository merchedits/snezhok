import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import type { OutboxEntry } from "../../types";
import { dispatchOutboxEntry, type OutboxTransport } from "./outboxDispatcher";

const message = { id: crypto.randomUUID(), clientId: crypto.randomUUID() } as Message;

test("outbox dispatcher resolves optimistic dependencies before remote mutation", async () => {
  const source = crypto.randomUUID();
  const durable = crypto.randomUUID();
  let received = "";
  const transport = fakeTransport({
    forwardMessage: async (messageId) => { received = messageId; return message; },
  });
  const entry = {
    kind: "forward",
    id: crypto.randomUUID(),
    streamId: crypto.randomUUID(),
    sourceMessageId: source,
    clientId: crypto.randomUUID(),
    queuedAt: Date.now(),
    attempts: 0,
  } satisfies OutboxEntry;
  const result = await dispatchOutboxEntry(transport, entry, new Map([[source, durable]]));
  assert.equal(received, durable);
  assert.equal(result.kind, "created");
});

test("per-user delete never calls the destructive endpoint", async () => {
  let hidden = 0;
  let deleted = 0;
  const transport = fakeTransport({
    hideMessage: async () => { hidden += 1; },
    deleteMessage: async () => { deleted += 1; return message; },
  });
  const entry = {
    kind: "delete",
    id: crypto.randomUUID(),
    streamId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
    scope: "me",
    previous: message,
    queuedAt: Date.now(),
    attempts: 0,
  } satisfies OutboxEntry;
  const result = await dispatchOutboxEntry(transport, entry, new Map());
  assert.equal(result.kind, "hidden");
  assert.equal(hidden, 1);
  assert.equal(deleted, 0);
});

function fakeTransport(overrides: Partial<OutboxTransport>): OutboxTransport {
  return {
    createMessage: async () => message,
    forwardMessage: async () => message,
    markRead: async () => undefined,
    editMessage: async () => message,
    hideMessage: async () => undefined,
    deleteMessage: async () => message,
    setMessagePinned: async () => message,
    setReaction: async () => message,
    ...overrides,
  };
}
