import assert from "node:assert/strict";
import test from "node:test";

import type { Attachment, Message } from "@snezhok/contracts";
import { emptyAttachmentRepository, normalizeAttachmentProjection, reconcileAttachmentProjection } from "./attachmentRepository";

test("one canonical attachment entity feeds forwarded message projections", () => {
  const processing = attachment({ status: "processing", updatedAt: 10, url: "/source" });
  const ready = attachment({ status: "ready", updatedAt: 20, url: "/primary", width: 900, height: 1200 });
  const first = message("10000000-0000-4000-8000-000000000010", "20000000-0000-4000-8000-000000000010", processing);
  const forwarded = message("10000000-0000-4000-8000-000000000020", "20000000-0000-4000-8000-000000000020", ready);
  const normalized = normalizeAttachmentProjection({ [first.streamId]: [first], [forwarded.streamId]: [forwarded] }, emptyAttachmentRepository);
  assert.equal(normalized.messages[first.streamId]![0]!.attachments[0], ready);
  assert.equal(normalized.messages[forwarded.streamId]![0]!.attachments[0], ready);
  assert.equal(normalized.repository.byId[ready.id], ready);
});

test("a legacy payload cannot downgrade a richer canonical entity", () => {
  const ready = attachment({ status: "ready", updatedAt: 20, url: "/primary", waveform: [0.2, 0.9] });
  const previous = normalizeAttachmentProjection({ stream: [message("10000000-0000-4000-8000-000000000010", "stream", ready)] });
  const legacy = attachment({ url: "/source" });
  const normalized = normalizeAttachmentProjection({ stream: [message("10000000-0000-4000-8000-000000000010", "stream", legacy)] }, previous.repository);
  assert.equal(normalized.messages.stream![0]!.attachments[0], ready);
});

test("incremental reconciliation updates shared references without scanning unrelated streams", () => {
  const processing = attachment({ status: "processing", updatedAt: 10 });
  const first = message("10000000-0000-4000-8000-000000000010", "20000000-0000-4000-8000-000000000010", processing);
  const second = message("10000000-0000-4000-8000-000000000020", "20000000-0000-4000-8000-000000000020", processing);
  const unrelated = message("10000000-0000-4000-8000-000000000030", "20000000-0000-4000-8000-000000000030", attachment({ id: "30000000-0000-4000-8000-000000000009" }));
  const beforeMessages = { [first.streamId]: [first], [second.streamId]: [second], [unrelated.streamId]: [unrelated] };
  const before = normalizeAttachmentProjection(beforeMessages);
  const ready = attachment({ status: "ready", updatedAt: 20, width: 900, height: 1200 });
  const nextMessages = { ...before.messages, [first.streamId]: [{ ...first, attachments: [ready] }] };
  const after = reconcileAttachmentProjection(nextMessages, before.messages, before.repository);
  assert.equal(after.messages[first.streamId]![0]!.attachments[0], ready);
  assert.equal(after.messages[second.streamId]![0]!.attachments[0], ready);
  assert.equal(after.messages[unrelated.streamId], before.messages[unrelated.streamId]);
});

function attachment(patch: Partial<Attachment>): Attachment {
  return {
    id: "30000000-0000-4000-8000-000000000001", ownerId: "40000000-0000-4000-8000-000000000001", kind: "image",
    filename: "photo.jpg", mimeType: "image/jpeg", bytes: 128, width: null, height: null, durationMs: null,
    quality: "auto", url: "/source", originalUrl: "/source", thumbnailUrl: null, checksum: "a".repeat(64), ...patch,
  };
}

function message(id: string, streamId: string, media: Attachment): Message {
  return {
    id, streamId, streamKind: "conversation", sequence: 1,
    sender: { id: media.ownerId, username: "owner", displayName: "Owner", avatarUrl: null, avatarColor: "violet", bio: "", statusText: "", presence: "online", lastSeenAt: 1 },
    kind: "media", text: "", replyTo: null, attachments: [media], reactions: [], createdAt: 1, editedAt: null, deletedAt: null, pinnedAt: null,
  };
}
