import assert from "node:assert/strict";
import test from "node:test";

import type { NativeTransferSnapshot } from "../../modules/snezhok-background-transfer";
import { applyInitializedAttachment, applyNativeSnapshot, batchComplete, batchProgress, createAttachmentBatch, optimisticMessagesForAttachmentBatch, readyAttachmentGroups } from "./backgroundTransferModel";

const input = { uri: "file:///private/photo.jpg", filename: "photo.jpg", mimeType: "image/jpeg", kind: "image" as const, quality: "auto" as const };

test("media batches split deterministically into 10 + 10 + remainder", () => {
  const batch = createAttachmentBatch({
    id: "batch", ownerId: "owner", streamId: "stream", messageKind: "media", replyToId: "reply",
    inputs: Array.from({ length: 23 }, () => input),
    transferIds: Array.from({ length: 23 }, (_, index) => `transfer-${index}`),
    clientIds: ["client-1", "client-2", "client-3"], now: 1,
  });
  assert.deepEqual(batch.groups.map((group) => group.transferIds.length), [10, 10, 3]);
  assert.deepEqual(batch.groups.map((group) => group.replyToId), ["reply", null, null]);
});

test("attachment captions stay on the first group and optimistic media uses local sources", () => {
  const batch = createAttachmentBatch({
    id: "batch", ownerId: "owner", streamId: "stream", messageKind: "media", replyToId: null, text: "A caption",
    inputs: [input], transferIds: ["transfer"], clientIds: ["client"], now: 10,
  });
  const messages = optimisticMessagesForAttachmentBatch({
    batch,
    sender: { id: "owner", username: "owner", displayName: "Owner", avatarUrl: null, avatarColor: "#000", bio: "", statusText: "", presence: "offline", lastSeenAt: 0 },
    streamKind: "conversation",
    startingSequence: 4,
  });
  assert.equal(messages[0]?.text, "A caption");
  assert.equal(messages[0]?.attachments[0]?.url, input.uri);
  assert.equal(messages[0]?.pending, true);
  assert.equal(messages[0]?.sequence, 4);
});

test("each optimistic album tile retains its gallery preview and individual progress", () => {
  const previewInput = { ...input, uri: "file:///staged-photo.jpg", previewUri: "content://gallery/original-photo" };
  let batch = createAttachmentBatch({
    id: "batch", ownerId: "owner", streamId: "stream", messageKind: "media", replyToId: null,
    inputs: [previewInput, previewInput], transferIds: ["first", "second"], clientIds: ["client"], now: 10,
  });
  batch = applyNativeSnapshot(batch, {
    transferId: "first", uploadId: "first", status: "running", uploadedBytes: 25, totalBytes: 100,
    progress: 25, attempt: 1, errorCode: null, createdAt: 1, updatedAt: 2, expiresAt: 10, allowMetered: true,
    resultJson: null,
  });
  batch = applyNativeSnapshot(batch, {
    transferId: "second", uploadId: "second", status: "running", uploadedBytes: 70, totalBytes: 100,
    progress: 70, attempt: 1, errorCode: null, createdAt: 1, updatedAt: 2, expiresAt: 10, allowMetered: true,
    resultJson: null,
  });
  const message = optimisticMessagesForAttachmentBatch({
    batch,
    sender: { id: "owner", username: "owner", displayName: "Owner", avatarUrl: null, avatarColor: "#000", bio: "", statusText: "", presence: "offline", lastSeenAt: 0 },
    streamKind: "conversation",
    startingSequence: 1,
  })[0]!;
  const decorated = message.attachments as Array<typeof message.attachments[number] & { localTransfer?: { progress: number } }>;
  assert.deepEqual(decorated.map((attachment) => attachment.url), [previewInput.previewUri, previewInput.previewUri]);
  assert.deepEqual(decorated.map((attachment) => attachment.localTransfer?.progress), [25, 70]);
});

test("optimistic voice notes expose the locally recorded waveform immediately and retain it through initialization", () => {
  const voiceInput = {
    ...input,
    kind: "audio" as const,
    filename: "voice.m4a",
    mimeType: "audio/mp4",
    localDurationMs: 2_400,
    localWaveform: [12, 48, 91],
  };
  const batch = createAttachmentBatch({
    id: "voice-batch", ownerId: "owner", streamId: "stream", messageKind: "voice", replyToId: null,
    inputs: [voiceInput], transferIds: ["voice-transfer"], clientIds: ["voice-message"], now: 10,
  });
  const optimistic = optimisticMessagesForAttachmentBatch({
    batch,
    sender: { id: "owner", username: "owner", displayName: "Owner", avatarUrl: null, avatarColor: "#000", bio: "", statusText: "", presence: "offline", lastSeenAt: 0 },
    streamKind: "conversation",
    startingSequence: 1,
  });
  assert.deepEqual(optimistic[0]?.attachments[0]?.waveform, voiceInput.localWaveform);
  assert.equal(optimistic[0]?.attachments[0]?.durationMs, voiceInput.localDurationMs);

  const initialized = applyInitializedAttachment(batch, "voice-transfer", {
    id: "voice-server", ownerId: "owner", kind: "audio", filename: "voice.m4a", mimeType: "audio/mp4",
    bytes: 4, width: null, height: null, durationMs: null, quality: "auto", url: "/files/voice-server",
    thumbnailUrl: null, checksum: "a".repeat(64), waveform: null,
  });
  assert.deepEqual(initialized.transfers[0]?.attachment?.waveform, voiceInput.localWaveform);
  assert.equal(initialized.transfers[0]?.attachment?.durationMs, voiceInput.localDurationMs);
});

test("file batches obey the server's ten-attachment message limit", () => {
  const batch = createAttachmentBatch({
    id: "batch", ownerId: "owner", streamId: "stream", messageKind: "file", replyToId: null,
    inputs: Array.from({ length: 12 }, () => ({ ...input, kind: "document" as const })),
    transferIds: Array.from({ length: 12 }, (_, index) => `transfer-${index}`),
    clientIds: ["client-1", "client-2"], now: 1,
  });
  assert.deepEqual(batch.groups.map((group) => group.transferIds.length), [10, 2]);
});

test("voice and video-note batches reject ambiguous multi-file input", () => {
  for (const messageKind of ["voice", "video-note"] as const) {
    assert.throws(() => createAttachmentBatch({
      id: "batch", ownerId: "owner", streamId: "stream", messageKind, replyToId: null,
      inputs: [input, input], transferIds: ["a", "b"], clientIds: ["client"], now: 1,
    }), /exactly one/);
  }
});

test("native results become ordered ready groups without retaining the staged URI", () => {
  let batch = createAttachmentBatch({
    id: "batch", ownerId: "owner", streamId: "stream", messageKind: "media", replyToId: null,
    inputs: [input, input], transferIds: ["a", "b"], clientIds: ["client"], now: 1,
  });
  const snapshot = (transferId: string, progress: number): NativeTransferSnapshot => ({
    transferId, uploadId: transferId, status: "succeeded", uploadedBytes: 4, totalBytes: 4, progress,
    attempt: 1, errorCode: null, createdAt: 1, updatedAt: 2, expiresAt: 10, allowMetered: true,
    resultJson: JSON.stringify({ attachment: {
      id: transferId, ownerId: "owner", kind: "image", filename: `${transferId}.jpg`, mimeType: "image/jpeg",
      bytes: 4, width: 1, height: 1, durationMs: null, quality: "auto", url: `/files/${transferId}`,
      originalUrl: `/files/${transferId}`, thumbnailUrl: null, checksum: "a".repeat(64),
    } }),
  });
  batch = applyNativeSnapshot(batch, snapshot("a", 100));
  assert.equal(readyAttachmentGroups(batch).length, 0);
  batch = applyNativeSnapshot(batch, snapshot("b", 100));
  assert.equal(batchProgress(batch), 100);
  assert.equal(batch.transfers[0]?.input.uri, "");
  assert.deepEqual(readyAttachmentGroups(batch)[0]?.attachments.map((attachment) => attachment.id), ["a", "b"]);
  assert.equal(batchComplete(batch), false);
});

test("an idempotent server initializer can reconcile an upload completed while JS was killed", () => {
  let batch = createAttachmentBatch({
    id: "batch", ownerId: "owner", streamId: "stream", messageKind: "media", replyToId: null,
    inputs: [input], transferIds: ["stable-upload"], clientIds: ["stable-message"], now: 1,
  });
  batch = applyInitializedAttachment(batch, "stable-upload", {
    id: "stable-upload", ownerId: "owner", kind: "image", filename: "photo.jpg", mimeType: "image/jpeg",
    bytes: 4, width: 1, height: 1, durationMs: null, quality: "auto", url: "/files/stable-upload",
    originalUrl: "/files/stable-upload", thumbnailUrl: null, checksum: "a".repeat(64),
  });
  assert.equal(batch.transfers[0]?.status, "succeeded");
  assert.equal(batch.transfers[0]?.progress, 100);
  assert.equal(batch.transfers[0]?.input.uri, "");
  assert.deepEqual(readyAttachmentGroups(batch)[0]?.attachments.map((attachment) => attachment.id), ["stable-upload"]);
});

test("a malformed native result remains recoverable and never throws reconciliation", () => {
  const batch = createAttachmentBatch({
    id: "batch", ownerId: "owner", streamId: "stream", messageKind: "voice", replyToId: null,
    inputs: [{ ...input, kind: "audio", mimeType: "audio/mp4", filename: "voice.m4a" }],
    transferIds: ["voice-transfer"], clientIds: ["voice-message"], now: 1,
  });
  const next = applyNativeSnapshot(batch, {
    transferId: "voice-transfer", uploadId: "voice-transfer", status: "succeeded", uploadedBytes: 4, totalBytes: 4,
    progress: 100, attempt: 1, errorCode: null, createdAt: 1, updatedAt: 2, expiresAt: 10, allowMetered: true,
    resultJson: "{not-json",
  });
  assert.equal(next.transfers[0]?.status, "pending");
  assert.equal(next.transfers[0]?.errorCode, "invalid_result");
  assert.equal(next.transfers[0]?.input.uri, input.uri);
});
