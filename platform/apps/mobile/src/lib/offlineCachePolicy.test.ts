import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import { cachedHistoryCursor, cachedMessagePage, cachedStreamDelta, decodeMessageRows, parseLegacyCache, startupStreamIds } from "./offlineCachePolicy";

function message(sequence: number, extra: Partial<Message> = {}): Message {
  return {
    id: `message-${sequence}`,
    streamId: "stream",
    streamKind: "conversation",
    sequence,
    sender: { id: "user", username: "user", displayName: "User", bio: "", statusText: "", avatarUrl: null, avatarColor: "#999", presence: "offline", lastSeenAt: 0 },
    kind: "text",
    text: String(sequence),
    replyTo: null,
    forwardedFrom: null,
    attachments: [],
    reactions: [],
    createdAt: sequence,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    ...extra,
  };
}

test("v2 migration preserves bootstrap and bounds messages without losing important rows", () => {
  const messages = Array.from({ length: 100 }, (_, index) => message(index, {
    pinnedAt: index === 1 ? 10 : null,
    pending: index === 2,
    failed: index === 3,
  }));
  const migrated = parseLegacyCache(JSON.stringify({ bootstrap: { eventCursor: 44 }, messages: { stream: messages }, cachedAt: 123 }));
  assert.equal(migrated?.cachedAt, 123);
  assert.equal((migrated?.bootstrap as { eventCursor?: number } | null)?.eventCursor, 44);
  assert.deepEqual(migrated?.messages.stream?.slice(0, 3).map((item) => item.id), ["message-1", "message-2", "message-3"]);
  assert.equal(migrated?.messages.stream?.length, 83);
  assert.equal(migrated?.messages.stream?.at(-1)?.id, "message-99");
});

test("damaged legacy snapshots and individual SQLite rows fail closed", () => {
  assert.equal(parseLegacyCache("not-json"), null);
  const decoded = decodeMessageRows([
    { stream_id: "stream", payload: JSON.stringify(message(1)) },
    { stream_id: "stream", payload: "damaged" },
  ]);
  assert.deepEqual(decoded.stream?.map((item) => item.id), ["message-1"]);
});

test("cached message pages use an exclusive sequence cursor and ascending display order", () => {
  const messages = Array.from({ length: 10 }, (_, index) => message(index + 1));
  assert.deepEqual(cachedMessagePage(messages, 8, 3).map((item) => item.sequence), [5, 6, 7]);
  assert.deepEqual(cachedMessagePage(messages, undefined, 2).map((item) => item.sequence), [9, 10]);
});

test("old important islands do not skip the contiguous cached history page", () => {
  const messages = [message(1, { pinnedAt: 10 }), message(61), message(62)];
  assert.equal(cachedHistoryCursor(messages), 61);
  assert.equal(cachedHistoryCursor([message(1, { failed: true })]), 1);
});

test("startup hydration prioritizes useful conversations and stays bounded", () => {
  const bootstrap = {
    conversations: [
      { id: "normal", saved: false, pinned: false, unreadCount: 0 },
      { id: "saved", saved: true, pinned: false, unreadCount: 0 },
      { id: "unread", saved: false, pinned: false, unreadCount: 2 },
    ],
    channels: [{ id: "channel", unreadCount: 4 }],
  } as unknown as NonNullable<import("../types").CachedState["bootstrap"]>;
  assert.deepEqual(startupStreamIds(bootstrap, 3), ["saved", "unread", "channel"]);
  assert.deepEqual(startupStreamIds(bootstrap, 0), []);
});

test("incremental persistence writes only changed rows and reconciles optimistic ids", () => {
  const unchanged = message(1);
  const changed = message(2, { text: "new", clientId: "optimistic" });
  const optimistic = message(20, { id: "optimistic", clientId: "optimistic", pending: true });
  const delta = cachedStreamDelta([
    { message_id: unchanged.id, payload: JSON.stringify(unchanged), important: 0 },
    { message_id: changed.id, payload: JSON.stringify(message(2, { text: "old" })), important: 0 },
    { message_id: optimistic.id, payload: JSON.stringify(optimistic), important: 1 },
    { message_id: "unloaded-history", payload: JSON.stringify(message(10, { id: "unloaded-history" })), important: 0 },
  ], [unchanged, changed]);

  assert.deepEqual(delta.upserts.map((entry) => entry.message.id), [changed.id]);
  assert.deepEqual(delta.removedIds, [optimistic.id]);
});
