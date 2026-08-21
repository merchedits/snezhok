import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import { decodeMessageList, decodeMessageValue } from "./messageDecoding";

const userId = "10000000-0000-4000-8000-000000000001";
const messageId = "20000000-0000-4000-8000-000000000001";
const streamId = "30000000-0000-4000-8000-000000000001";
const attachmentId = "40000000-0000-4000-8000-000000000001";

function message(extra: Record<string, unknown> = {}): Message {
  return {
    id: messageId, revision: 1, clientId: null, streamId, streamKind: "conversation", sequence: 1,
    sender: { id: userId, username: "tester", displayName: "Tester", avatarUrl: null, avatarColor: "#000", bio: "", statusText: "", presence: "offline", lastSeenAt: 0 },
    kind: "media", text: "", replyTo: null, forwardedFrom: null, attachments: [], reactions: [], activity: null,
    createdAt: 1, editedAt: null, deletedAt: null, pinnedAt: null, readByOthers: false, silent: false,
    ...extra,
  } as Message;
}

test("repairs a legacy attachment without allowing it to reject the message", () => {
  const decoded = decodeMessageValue(message({ attachments: [{ id: attachmentId, kind: "image", url: "" }] }));
  assert.ok(decoded.message);
  assert.equal(decoded.repaired, true);
  assert.equal(decoded.message.attachments[0]?.url, `/api/v1/files/${attachmentId}`);
  assert.equal(decoded.message.attachments[0]?.ownerId, userId);
  assert.equal(decoded.message.attachments[0]?.width, null);
});

test("isolates irrecoverable nested content and rejects only invalid core records", () => {
  const decoded = decodeMessageList([
    message({ attachments: [{ nope: true }], reactions: [{ emoji: "x", count: "bad" }] }),
    { attachments: [] },
    message({ id: "20000000-0000-4000-8000-000000000002", sequence: 2 }),
  ]);
  assert.equal(decoded.messages.length, 2);
  assert.equal(decoded.rejectedMessages, 1);
  assert.equal(decoded.repairedMessages, 1);
  assert.equal(decoded.rejectedAttachments, 1);
});

test("does not pass unsafe absolute media URLs to native clients", () => {
  const decoded = decodeMessageValue(message({ attachments: [{
    id: attachmentId, ownerId: userId, kind: "image", filename: "x.jpg", mimeType: "image/jpeg", bytes: 1,
    width: 1, height: 1, durationMs: null, quality: "auto", url: "http://attacker.invalid/x", thumbnailUrl: null, checksum: "x",
  }] }));
  assert.equal(decoded.message?.attachments[0]?.url, `/api/v1/files/${attachmentId}`);
});
