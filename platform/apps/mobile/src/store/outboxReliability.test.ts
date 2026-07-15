import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import type { OutboxEntry } from "../types";
import { mergeMessages } from "./messageReconciliation";
import { enqueueOutbox, replayOutbox, resolveOutboxMessageId } from "./outboxReliability";

test("read retries remain monotonic while offline", () => {
  const high = read("high", "chat", 40);
  const stale = read("stale", "chat", 12);
  const queued = enqueueOutbox(enqueueOutbox([], high), stale);
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.kind, "read");
  assert.equal(queued[0]?.kind === "read" ? queued[0].sequence : 0, 40);
});

test("reconnect preserves per-stream ordering without blocking another user's chat", async () => {
  const entries: OutboxEntry[] = [messageEntry("a1", "alice-bob"), messageEntry("a2", "alice-bob"), messageEntry("c1", "alice-carol")];
  const delivered: string[] = [];
  let disconnected = true;
  const remaining = new Set(entries.map((entry) => entry.id));
  await replayOutbox(entries, async (entry) => {
    if (entry.id === "a1" && disconnected) { disconnected = false; throw new Error("connection lost"); }
    delivered.push(entry.id);
  }, (entry) => remaining.delete(entry.id), () => undefined);
  assert.deepEqual(delivered, ["c1"], "a2 waits for a1 but the independent Carol stream continues");

  await replayOutbox(entries.filter((entry) => remaining.has(entry.id)), async (entry) => { delivered.push(entry.id); }, (entry) => remaining.delete(entry.id), () => undefined);
  assert.deepEqual(delivered, ["c1", "a1", "a2"]);
  assert.equal(remaining.size, 0);
});

test("two-user realtime and HTTP echoes reconcile exactly once", () => {
  const alice = message("server-a", "client-a", 1, "alice");
  const bob = message("server-b", "client-b", 2, "bob");
  const aliceOptimistic = { ...alice, id: "client-a", pending: true };
  const merged = mergeMessages([aliceOptimistic], [bob, alice, bob, alice]);
  assert.deepEqual(merged.map((item) => item.id), ["server-a", "server-b"]);
});

test("coalesced offline edits retain the server-backed rollback snapshot", () => {
  const original = message("server-a", "client-a", 1, "alice");
  const first: OutboxEntry = { kind: "edit", id: "e1", streamId: original.streamId, messageId: original.id, text: "first", previous: original, queuedAt: 1, attempts: 0 };
  const second: OutboxEntry = { kind: "edit", id: "e2", streamId: original.streamId, messageId: original.id, text: "second", previous: { ...original, text: "first" }, queuedAt: 2, attempts: 0 };
  const queued = enqueueOutbox(enqueueOutbox([], first), second);
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.kind === "edit" ? queued[0].previous.text : "", "server-a");
});

test("queued mutations resolve an acknowledged optimistic message id", () => {
  const ids = new Map([["client-message", "server-message"]]);
  assert.equal(resolveOutboxMessageId("client-message", ids), "server-message");
  assert.equal(resolveOutboxMessageId("unrelated", ids), "unrelated");
});

function read(id: string, streamId: string, sequence: number): OutboxEntry {
  return { kind: "read", id, streamId, sequence, queuedAt: 1, attempts: 0 };
}

function messageEntry(id: string, streamId: string): OutboxEntry {
  return { kind: "message", id, streamId, queuedAt: 1, attempts: 0, input: { clientId: id, text: id, kind: "text", replyToId: null, attachmentIds: [], silent: false } };
}

function message(id: string, clientId: string, sequence: number, senderId: string): Message {
  return { id, clientId, streamId: "shared", streamKind: "conversation", sequence, sender: { id: senderId, username: senderId, displayName: senderId, avatarUrl: null, avatarColor: "#fff", bio: "", statusText: "", presence: "online", lastSeenAt: 0 }, kind: "text", text: id, replyTo: null, attachments: [], reactions: [], createdAt: sequence, editedAt: null, deletedAt: null, pinnedAt: null, silent: false };
}
