import assert from "node:assert/strict";
import test from "node:test";

import type { Attachment, AttachmentLifecycleUpdate, Message } from "@snezhok/contracts";
import { applyAttachmentLifecycleToMessages } from "./attachmentProjection";

const original: Attachment = {
  id: "10000000-0000-4000-8000-000000000001",
  ownerId: "10000000-0000-4000-8000-000000000002",
  kind: "audio",
  filename: "note.m4a",
  mimeType: "audio/mp4",
  bytes: 128,
  width: null,
  height: null,
  durationMs: null,
  quality: "auto",
  url: "/files/source",
  originalUrl: "/files/source",
  thumbnailUrl: null,
  checksum: "a".repeat(64),
  waveform: null,
  status: "processing",
  updatedAt: 10,
};

test("durable worker completion patches every message and activity reference", () => {
  const message = fixtureMessage(original);
  message.activity = {
    id: "20000000-0000-4000-8000-000000000001", conversationId: message.streamId, anchorMessageId: message.id,
    type: "tiny-quest", state: "active", revision: 1, createdBy: message.sender.id, config: {}, privateState: {}, result: null,
    participants: [], entries: [{ id: "30000000-0000-4000-8000-000000000001", kind: "submission", round: 0, createdBy: message.sender.id, payload: {}, attachments: [original], createdAt: 1, updatedAt: 1 }],
    createdAt: 1, updatedAt: 1, revealAt: null, completedAt: null,
  };
  const ready = { ...original, status: "ready" as const, updatedAt: 20, durationMs: 5_000, waveform: [0.1, 0.8], url: "/files/primary" };
  const update: AttachmentLifecycleUpdate = { id: original.id, status: "ready", updatedAt: 20, attachment: ready };

  const result = applyAttachmentLifecycleToMessages({ [message.streamId]: [message] }, update);
  assert.deepEqual(result.changedStreamIds, [message.streamId]);
  assert.equal(result.messages[message.streamId]![0]!.attachments[0], ready);
  assert.equal(result.messages[message.streamId]![0]!.activity!.entries[0]!.attachments[0], ready);
});

test("an older lifecycle delivery cannot replace a newer attachment", () => {
  const current = { ...original, status: "ready" as const, updatedAt: 30 };
  const message = fixtureMessage(current);
  const result = applyAttachmentLifecycleToMessages({ [message.streamId]: [message] }, {
    id: original.id, status: "processing", updatedAt: 20, attachment: original,
  });
  assert.equal(result.messages[message.streamId]![0], message);
  assert.deepEqual(result.changedStreamIds, []);
});

function fixtureMessage(attachment: Attachment): Message {
  return {
    id: "40000000-0000-4000-8000-000000000001", streamId: "50000000-0000-4000-8000-000000000001", streamKind: "conversation",
    sequence: 1, sender: { id: "10000000-0000-4000-8000-000000000002", username: "tester", displayName: "Tester", avatarUrl: null, avatarColor: "violet", bio: "", statusText: "", presence: "online", lastSeenAt: 1 },
    kind: "voice", text: "", replyTo: null, attachments: [attachment], reactions: [], createdAt: 1, editedAt: null, deletedAt: null, pinnedAt: null,
  };
}
