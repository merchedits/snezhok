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

test("a legacy attachment cannot make realtime skip a valid durable message", () => {
  const senderId = crypto.randomUUID();
  const message = {
    id: crypto.randomUUID(), revision: 1, clientId: null, streamId: crypto.randomUUID(), streamKind: "conversation", sequence: 1,
    sender: { id: senderId, username: "tester", displayName: "Tester", avatarUrl: null, avatarColor: "#000", bio: "", statusText: "", presence: "offline", lastSeenAt: 0 },
    kind: "media", text: "", replyTo: null, forwardedFrom: null,
    attachments: [{ id: crypto.randomUUID(), kind: "image" }], reactions: [], activity: null,
    createdAt: 1, editedAt: null, deletedAt: null, pinnedAt: null, readByOthers: false, silent: false,
  };
  const decoded = decodeRealtimeEvent("sync:event", { cursor: 1, name: "message:created", payload: message });
  assert.equal(decoded.success, true);
  if (decoded.success && decoded.data.name === "message:created") {
    assert.equal(decoded.data.payload.attachments[0]?.ownerId, senderId);
  }
});
