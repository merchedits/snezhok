import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import { boundedMessageWindow, messagesForCache, normalizeCachedMessages } from "./cachePolicy";

test("legacy cached messages are made safe without touching session state", () => {
  const normalized = normalizeCachedMessages({
    stream: [{ id: "message", streamId: "stream", sequence: 1, createdAt: 1, sender: { id: "user" }, text: "old cache" }],
  });
  assert.equal(normalized.stream?.length, 1);
  assert.deepEqual(normalized.stream?.[0]?.attachments, []);
  assert.deepEqual(normalized.stream?.[0]?.reactions, []);
});

test("cooperative activity cards survive the offline chat cache intact", () => {
  const activity = {
    id: "activity",
    messageId: "message",
    conversationId: "stream",
    type: "question",
    state: "waiting",
    revision: 1,
    config: { prompt: "A shared question", secret: true },
    participants: [],
    entries: [],
    createdBy: "user",
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    revealAt: null,
  };
  const normalized = normalizeCachedMessages({
    stream: [{ id: "message", streamId: "stream", sequence: 1, createdAt: 1, sender: { id: "user" }, attachments: [], reactions: [], activity }],
  });

  assert.deepEqual(normalized.stream?.[0]?.activity, activity);
});

test("invalid cached records are discarded instead of reaching chat rendering", () => {
  assert.deepEqual(normalizeCachedMessages({ stream: [{ id: "missing-fields" }, null] }), { stream: [] });
  assert.deepEqual(normalizeCachedMessages(null), {});
});

test("offline cache keeps a recent window plus important older messages", () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({
    id: `message-${index}`,
    streamId: "stream",
    sequence: index,
    createdAt: index,
    sender: { id: "user" },
    attachments: [],
    reactions: [],
    pinnedAt: index === 2 ? 123 : null,
    pending: index === 3,
    failed: index === 4,
  })) as unknown as Message[];
  const cached = messagesForCache({ stream: messages }, 10).stream ?? [];
  assert.equal(cached.length, 13);
  assert.deepEqual(cached.slice(0, 3).map((message) => message.id), ["message-2", "message-3", "message-4"]);
  assert.equal(cached.at(-1)?.id, "message-99");
});

test("live message windows retain the requested edge and important messages", () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    id: `message-${index}`,
    streamId: "stream",
    sequence: index,
    createdAt: index,
    sender: { id: "user" },
    attachments: [],
    reactions: [],
    pinnedAt: index === 2 ? 123 : null,
    pending: index === 3,
    failed: index === 4,
  })) as unknown as Message[];

  assert.deepEqual(boundedMessageWindow(messages, 5, "latest").map((message) => message.sequence), [2, 3, 4, 15, 16, 17, 18, 19]);
  assert.deepEqual(boundedMessageWindow(messages, 5, "older").map((message) => message.sequence), [0, 1, 2, 3, 4]);
});
