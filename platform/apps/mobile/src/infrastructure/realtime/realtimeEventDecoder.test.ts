import assert from "node:assert/strict";
import test from "node:test";

import { decodeRealtimeEvent } from "./realtimeEventDecoder";

test("realtime trust boundary rejects malformed durable payloads", () => {
  assert.equal(decodeRealtimeEvent("message:deleted", { id: "not-an-id", streamId: "also-bad", deletedAt: -1 }).success, false);
  assert.equal(decodeRealtimeEvent("read:updated", { streamId: crypto.randomUUID(), userId: crypto.randomUUID(), sequence: -1 }).success, false);
});

test("durable envelope never advances a cursor around an invalid nested event", () => {
  const decoded = decodeRealtimeEvent("sync:event", {
    cursor: 42,
    name: "message:deleted",
    payload: { id: "not-an-id", streamId: crypto.randomUUID(), deletedAt: Date.now() },
  });
  assert.equal(decoded.success, false);
  assert.equal(decodeRealtimeEvent("sync:event", {
    cursor: 42,
    name: "message:deleted",
    payload: { id: crypto.randomUUID(), streamId: crypto.randomUUID(), deletedAt: Date.now() },
  }).success, true);
});

test("realtime trust boundary bounds ephemeral drawing payloads", () => {
  const base = { streamId: crypto.randomUUID(), activityId: crypto.randomUUID(), userId: crypto.randomUUID(), sequence: 1 };
  assert.equal(decodeRealtimeEvent("activity:drawing:updated", { ...base, strokes: [[[10, 10], [20, 20]]] }).success, true);
  assert.equal(decodeRealtimeEvent("activity:drawing:updated", { ...base, strokes: [[[10, 10], [9_999, 20]]] }).success, false);
});
