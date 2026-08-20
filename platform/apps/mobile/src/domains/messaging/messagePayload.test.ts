import assert from "node:assert/strict";
import test from "node:test";

import type { Attachment, Message } from "@snezhok/contracts";

import { normalizeMessagePayload, renderableAttachments } from "./messagePayload";

const attachment: Attachment = {
  id: "attachment-1",
  ownerId: "user-1",
  kind: "image",
  filename: "photo.jpg",
  mimeType: "image/jpeg",
  bytes: 12,
  width: 100,
  height: 80,
  durationMs: null,
  quality: "auto",
  url: "/api/v1/files/attachment-1",
  thumbnailUrl: null,
  checksum: "checksum",
};

test("damaged attachment entries never reach the chat renderer", () => {
  assert.deepEqual(renderableAttachments(undefined), []);
  assert.deepEqual(renderableAttachments([null, {}, { ...attachment, url: "" }, attachment, attachment]), [attachment]);
});

test("healthy messages retain identity while damaged cached payloads are repaired", () => {
  const healthy = message([attachment]);
  assert.equal(normalizeMessagePayload(healthy), healthy);

  const damaged = message([null, attachment] as unknown as Attachment[]);
  const repaired = normalizeMessagePayload(damaged);
  assert.notEqual(repaired, damaged);
  assert.deepEqual(repaired.attachments, [attachment]);
  assert.deepEqual(repaired.reactions, []);
});

function message(attachments: Attachment[]): Message {
  return {
    id: "message-1",
    clientId: null,
    streamId: "stream-1",
    streamKind: "conversation",
    sequence: 1,
    sender: { id: "user-1", username: "tester", displayName: "Tester", avatarUrl: null, avatarColor: "#3858E8", bio: "", statusText: "", presence: "offline", lastSeenAt: 0 },
    kind: "media",
    text: "",
    replyTo: null,
    forwardedFrom: null,
    attachments,
    reactions: [],
    activity: null,
    createdAt: 1,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    readByOthers: false,
    silent: false,
  };
}
