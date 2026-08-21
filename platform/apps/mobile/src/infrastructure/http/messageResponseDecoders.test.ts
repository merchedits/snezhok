import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import { resilientMessageEnvelopeDecoder, resilientMessagePageDecoder } from "./messageResponseDecoders";

const senderId = "10000000-0000-4000-8000-000000000001";
const streamId = "20000000-0000-4000-8000-000000000001";

function message(id: string, extra: Record<string, unknown> = {}): Message {
  return {
    id, revision: 1, clientId: null, streamId, streamKind: "conversation", sequence: 1,
    sender: { id: senderId, username: "tester", displayName: "Tester", avatarUrl: null, avatarColor: "#000", bio: "", statusText: "", presence: "offline", lastSeenAt: 0 },
    kind: "text", text: "hello", replyTo: null, forwardedFrom: null, attachments: [], reactions: [], activity: null,
    createdAt: 1, editedAt: null, deletedAt: null, pinnedAt: null, readByOthers: false, silent: false,
    ...extra,
  } as Message;
}

test("history keeps healthy records when one core message is corrupt", () => {
  const validId = "30000000-0000-4000-8000-000000000001";
  const result = resilientMessagePageDecoder.parse({ items: [message(validId), { broken: true }], nextCursor: null });
  assert.deepEqual(result.items.map((item) => item.id), [validId]);
});

test("mutation responses repair compatible legacy attachments", () => {
  const id = "30000000-0000-4000-8000-000000000002";
  const attachmentId = "40000000-0000-4000-8000-000000000001";
  const result = resilientMessageEnvelopeDecoder.parse({
    message: message(id, { kind: "media", text: "", attachments: [{ id: attachmentId, kind: "image" }] }),
  });
  assert.equal(result.message.attachments[0]?.url, `/api/v1/files/${attachmentId}`);
});

test("history still rejects an invalid envelope cursor", () => {
  assert.throws(() => resilientMessagePageDecoder.parse({ items: [], nextCursor: 7 }));
});
