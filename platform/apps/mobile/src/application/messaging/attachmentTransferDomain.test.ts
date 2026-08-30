import assert from "node:assert/strict";
import test from "node:test";

import type { Attachment, Message, UserSummary } from "@snezhok/contracts";

import { emptyAttachmentRepository } from "../../repositories/attachments/attachmentRepository";
import { emptyMessageRepository } from "../../repositories/messages/messageRepository";
import { defaultRuntimeCapabilities, defaultSettings, type AppState, type AppStorePatch } from "../../store/appState";
import { TransferManager } from "../../transfers/transferManager";
import { createAttachmentBatch } from "../../transfers/backgroundTransferModel";
import type { UploadInput } from "../../types";
import {
  createAttachmentTransferDomain,
  type AttachmentTransferDependencies,
} from "./attachmentTransferDomain";

test("foreground media upload preserves order and creates deterministic 10 + 10 + 3 albums", async () => {
  const fixture = createFixture();
  const inputs = Array.from({ length: 23 }, (_, index) => uploadInput(index));

  await fixture.domain.actions.sendAttachmentBatch("chat", inputs, "media", "reply").completion;

  assert.equal(fixture.sent.length, 3);
  assert.deepEqual(fixture.sent.map((item) => item.attachments.map((attachment) => attachment.id).length), [10, 10, 3]);
  assert.deepEqual(fixture.sent.map((item) => item.replyToId), ["reply", null, null]);
  assert.deepEqual(fixture.sent.flatMap((item) => item.attachments.map((attachment) => attachment.filename)), inputs.map((item) => item.filename));
});

test("foreground upload progress is monotonic across the complete batch", async () => {
  const fixture = createFixture();
  await fixture.domain.actions.sendAttachmentBatch("chat", [uploadInput(0), uploadInput(1)], "media", null).completion;

  assert.deepEqual(fixture.progress, [0, 25, 50, 75, 100]);
});

test("an account change aborts the batch before a message can be sent", async () => {
  let current = true;
  const fixture = createFixture({
    guardIsCurrent: () => current,
    upload: async (input, onProgress) => {
      onProgress?.(100);
      current = false;
      return attachment(input, 0);
    },
  });

  await assert.rejects(
    fixture.domain.actions.sendAttachmentBatch("chat", [uploadInput(0)], "media", null).completion,
    /Account changed/,
  );
  assert.equal(fixture.sent.length, 0);
});

test("background batches are accepted after durable projection and before media preparation completes", async () => {
  const steps: string[] = [];
  let releasePreparation: () => void = () => undefined;
  const preparationGate = new Promise<void>((resolve) => { releasePreparation = resolve; });
  const background = enabledBackground(steps);
  const fixture = createFixture({
    background,
    prepareMany: async (inputs) => {
      steps.push("prepare");
      await preparationGate;
      return [...inputs];
    },
  });

  const handle = fixture.domain.actions.sendAttachmentBatch("chat", [uploadInput(0)], "media", null);
  await handle.accepted;

  assert.deepEqual(steps, ["persist", "project", "prepare"]);
  releasePreparation();
  await handle.completion;
  assert.deepEqual(steps, ["persist", "project", "prepare", "replace", "resume", "wait"]);
});

interface Overrides {
  guardIsCurrent?: () => boolean;
  upload?: AttachmentTransferDependencies<number>["transport"]["upload"];
  background?: AttachmentTransferDependencies<number>["background"];
  prepareMany?: AttachmentTransferDependencies<number>["media"]["prepareMany"];
}

function createFixture(overrides: Overrides = {}) {
  let state = baseState();
  const progress: number[] = [];
  const sent: Array<{ replyToId: string | null; attachments: Attachment[] }> = [];
  const set = (patch: AppStorePatch) => {
    const value = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...value };
  };
  let uploadIndex = 0;
  const transport: AttachmentTransferDependencies<number>["transport"] = {
    upload: overrides.upload ?? (async (input, onProgress) => {
      onProgress?.(50);
      onProgress?.(100);
      return attachment(input, uploadIndex++);
    }),
    createMessage: async () => message(),
    cancelUpload: async () => undefined,
  };
  const background = overrides.background ?? disabledBackground();
  const manager = new TransferManager();
  manager.subscribe((snapshots) => {
    const parent = snapshots.find((snapshot) => !snapshot.id.includes(":"));
    if (parent && progress.at(-1) !== parent.progress) progress.push(parent.progress);
  });
  let operationId = 0;
  const domain = createAttachmentTransferDomain({
    get: () => state,
    captureGuard: () => 1,
    guardIsCurrent: overrides.guardIsCurrent ?? (() => true),
    sessionIsActive: () => true,
    createId: () => `batch-${++operationId}`,
    transport,
    media: { prepareOne: async (input) => input, prepareMany: overrides.prepareMany ?? (async (inputs) => [...inputs]) },
    background,
    manager,
  });
  state.sendMessage = async (_streamId, input, optimisticAttachments) => {
    sent.push({ replyToId: input.replyToId, attachments: optimisticAttachments ?? [] });
  };
  return { domain, get state() { return state; }, sent, progress };
}

function enabledBackground(steps: string[]): AttachmentTransferDependencies<number>["background"] {
  return {
    available: true,
    enqueueBatch: async (input) => {
      steps.push("persist");
      const batch = createAttachmentBatch({
        id: "native-batch", ownerId: input.ownerId, streamId: input.streamId, messageKind: input.messageKind,
        replyToId: input.replyToId, ...(input.text === undefined ? {} : { text: input.text }),
        inputs: input.inputs, transferIds: ["native-transfer"],
        clientIds: ["native-message"], now: 1,
      });
      input.onCreated?.(batch);
      steps.push("project");
      return batch.id;
    },
    replaceBatchInputs: async () => { steps.push("replace"); },
    resumeBatch: async () => { steps.push("resume"); },
    failBatch: async () => undefined,
    waitForBatch: async () => { steps.push("wait"); },
    cancelBatch: async () => undefined,
    reconcile: async () => undefined,
    retryForMessage: async () => null,
  };
}

function disabledBackground(): AttachmentTransferDependencies<number>["background"] {
  return {
    available: false,
    enqueueBatch: async () => "unused",
    replaceBatchInputs: async () => undefined,
    resumeBatch: async () => undefined,
    failBatch: async () => undefined,
    waitForBatch: async () => undefined,
    cancelBatch: async () => undefined,
    reconcile: async () => undefined,
    retryForMessage: async () => null,
  };
}

function baseState(): AppState {
  return {
    phase: "ready", error: null, online: true, syncing: false, eventCursor: 0, me: user("me"),
    conversations: [], servers: [], categories: [], channels: [], friends: [], settings: defaultSettings,
    capabilities: defaultRuntimeCapabilities, messages: {}, attachmentRepository: emptyAttachmentRepository,
    messageRepository: emptyMessageRepository, messagePagination: {}, drafts: {}, folders: [], scheduledMessages: [],
    outbox: [], sendMessage: async () => message(), applyMessage: () => undefined,
  } as unknown as AppState;
}

function uploadInput(index: number): UploadInput {
  return {
    uri: `file:///photo-${index}.jpg`, filename: `photo-${index}.jpg`, mimeType: "image/jpeg", kind: "image", quality: "auto",
    sourceWidth: 1080, sourceHeight: 1920,
  };
}

function attachment(input: UploadInput, index: number): Attachment {
  return {
    id: `attachment-${index}`, ownerId: "me", kind: input.kind, filename: input.filename, mimeType: input.mimeType,
    bytes: 128, width: input.sourceWidth ?? null, height: input.sourceHeight ?? null, durationMs: null, quality: input.quality,
    url: `/files/attachment-${index}`, thumbnailUrl: null, checksum: `${index}`.padStart(64, "0"),
  };
}

function user(id: string): UserSummary {
  return { id, username: id, displayName: id, avatarUrl: null, avatarColor: "#000", presence: "offline", lastSeenAt: 0 } as UserSummary;
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "message", clientId: null, streamId: "chat", streamKind: "conversation", sequence: 1, revision: 1,
    sender: user("me"), kind: "media", text: "", replyTo: null, forwardedFrom: null, attachments: [], reactions: [],
    createdAt: 1, editedAt: null, deletedAt: null, pinnedAt: null, silent: false, readByOthers: false, pending: false, failed: false,
    ...overrides,
  } as Message;
}
