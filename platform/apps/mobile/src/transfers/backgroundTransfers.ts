import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import type { Attachment, Message } from "@snezhok/contracts";

import {
  addNativeTransferListener,
  cancelNativeTransfer,
  enqueueNativeTransfer,
  listNativeTransfers,
  removeNativeTransfer,
  resumeNativeTransfer,
  type NativeTransferSnapshot,
} from "../../modules/snezhok-background-transfer";
import { API_URL, api } from "../infrastructure/http/apiClient";
import type { MessageCreateInput, UploadInput } from "../types";
import {
  applyNativeSnapshot,
  applyInitializedAttachment,
  attachmentGroupSize,
  batchComplete,
  batchCancelled,
  batchFailed,
  batchProgress,
  createAttachmentBatch,
  readyAttachmentGroups,
  type AttachmentMessageKind,
  type QueuedAttachmentBatch,
  type QueuedAttachmentGroup,
} from "./backgroundTransferModel";
import { clearBackgroundTransferBatches, MAX_ACTIVE_TRANSFERS, mutateBackgroundTransferBatches, readBackgroundTransferBatches } from "./backgroundTransferRepository";
import { UploadCancelledError } from "../lib/uploadPolicy";

export interface BackgroundGroupDispatch {
  batch: QueuedAttachmentBatch;
  group: QueuedAttachmentGroup;
  attachments: Attachment[];
  input: MessageCreateInput;
}

export class BackgroundTransferFailedError extends Error {
  constructor(readonly batchId: string) {
    super("One or more background transfers failed");
    this.name = "BackgroundTransferFailedError";
  }
}

export class BackgroundTransferQueueFullError extends Error {
  constructor() {
    super("Too many attachment transfers are already pending");
    this.name = "BackgroundTransferQueueFullError";
  }
}

type DispatchGroup = (input: BackgroundGroupDispatch) => Promise<Message>;
type WakeCallback = () => void;

const wakeCallbacks = new Set<WakeCallback>();
let nativeSubscription: { remove(): void } | null = null;
let appStateSubscription: { remove(): void } | null = null;
let reconciliation: Promise<void> | null = null;

export function installBackgroundTransferWakeListener(callback: WakeCallback): () => void {
  wakeCallbacks.add(callback);
  if (!nativeSubscription) {
    nativeSubscription = addNativeTransferListener(() => notifyWakeCallbacks());
    appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") notifyWakeCallbacks();
    });
  }
  return () => {
    wakeCallbacks.delete(callback);
    if (!wakeCallbacks.size) {
      nativeSubscription?.remove();
      appStateSubscription?.remove();
      nativeSubscription = null;
      appStateSubscription = null;
    }
  };
}

export async function enqueueBackgroundAttachmentBatch(input: {
  ownerId: string;
  streamId: string;
  messageKind: AttachmentMessageKind;
  replyToId: string | null;
  silent?: boolean;
  inputs: UploadInput[];
  onCreated?: (batchId: string) => void;
}): Promise<string> {
  const batchId = Crypto.randomUUID();
  const groupSize = attachmentGroupSize(input.messageKind);
  const batch = createAttachmentBatch({
    id: batchId,
    ownerId: input.ownerId,
    streamId: input.streamId,
    messageKind: input.messageKind,
    replyToId: input.replyToId,
    ...(input.silent === undefined ? {} : { silent: input.silent }),
    inputs: input.inputs,
    transferIds: input.inputs.map(() => Crypto.randomUUID()),
    clientIds: Array.from({ length: Math.ceil(input.inputs.length / groupSize) }, () => Crypto.randomUUID()),
  });
  // The intent is durable before the first upload session is initialized. If
  // Android kills the process in the next instruction, reconciliation can
  // safely initialize the same deterministic transfer/message identifiers.
  await mutateBackgroundTransferBatches((current) => {
    const activeTransferCount = current
      .filter((item) => !batchComplete(item))
      .reduce((total, item) => total + item.transfers.length, 0);
    if (activeTransferCount + batch.transfers.length > MAX_ACTIVE_TRANSFERS) throw new BackgroundTransferQueueFullError();
    return [batch, ...current.filter((item) => item.id !== batch.id)];
  });
  input.onCreated?.(batchId);
  await schedulePendingTransfers(batchId);
  return batchId;
}

export async function reconcileBackgroundTransfers(input: {
  ownerId: string;
  online: boolean;
  dispatchGroup: DispatchGroup;
  onProgress?: (batchId: string, progress: number) => void;
}): Promise<void> {
  if (reconciliation) return reconciliation;
  reconciliation = reconcileOnce(input).finally(() => { reconciliation = null; });
  return reconciliation;
}

export async function waitForBackgroundBatch(input: {
  batchId: string;
  ownerId: string;
  isOnline: () => boolean;
  dispatchGroup: DispatchGroup;
  onProgress?: (progress: number) => void;
}): Promise<void> {
  while (true) {
    await reconcileBackgroundTransfers({
      ownerId: input.ownerId,
      online: input.isOnline(),
      dispatchGroup: input.dispatchGroup,
      ...(input.onProgress ? { onProgress: (batchId, progress) => { if (batchId === input.batchId) input.onProgress!(progress); } } : {}),
    });
    const batch = (await readBackgroundTransferBatches()).find((item) => item.id === input.batchId);
    if (!batch) return;
    if (batchComplete(batch)) {
      await cleanupCompletedBatch(batch);
      return;
    }
    if (batchCancelled(batch)) {
      await forgetBackgroundBatch(batch.id);
      throw new UploadCancelledError();
    }
    if (batchFailed(batch)) {
      await cancelBackgroundBatch(batch.id);
      await forgetBackgroundBatch(batch.id);
      throw new BackgroundTransferFailedError(input.batchId);
    }
    await waitForWake(1_000);
  }
}

export async function cancelBackgroundBatch(batchId: string): Promise<void> {
  const batch = (await readBackgroundTransferBatches()).find((item) => item.id === batchId);
  if (!batch) return;
  await Promise.all(batch.transfers.flatMap((transfer) => [
    cancelNativeTransfer(transfer.transferId).catch(() => null),
    api.cancelInitializedUpload(transfer.transferId).catch(() => undefined),
  ]));
  await mutateBackgroundTransferBatches((current) => current.map((item) => item.id !== batchId ? item : {
    ...item,
    updatedAt: Date.now(),
    transfers: item.transfers.map((transfer) => ({ ...transfer, status: "cancelled", errorCode: null })),
  }));
  notifyWakeCallbacks();
}

export async function clearAllBackgroundTransfers(): Promise<void> {
  const batches = await readBackgroundTransferBatches();
  await Promise.all(batches.flatMap((batch) => batch.transfers.flatMap((transfer) => [
    cancelNativeTransfer(transfer.transferId).catch(() => null),
    api.cancelInitializedUpload(transfer.transferId).catch(() => undefined),
  ])));
  await clearBackgroundTransferBatches();
}

async function schedulePendingTransfers(batchId: string): Promise<void> {
  let nativeById = new Map((await listNativeTransfers()).map((snapshot) => [snapshot.transferId, snapshot]));
  const batch = (await readBackgroundTransferBatches()).find((item) => item.id === batchId);
  if (!batch) return;
  for (const transfer of batch.transfers.sort((left, right) => left.position - right.position)) {
    const liveTransfer = (await readBackgroundTransferBatches()).find((item) => item.id === batchId)
      ?.transfers.find((item) => item.transferId === transfer.transferId);
    if (!liveTransfer || liveTransfer.status === "cancelled") continue;
    const existing = nativeById.get(transfer.transferId);
    if (existing) {
      await storeNativeSnapshot(batchId, existing);
      if (["staging", "queued", "running", "retrying"].includes(existing.status)
        || (existing.status === "failed" && existing.errorCode === "source_unavailable" && transfer.input.uri)) {
        const resumed = await resumeNativeTransfer(
          transfer.transferId,
          existing.status === "staging" || existing.errorCode === "source_unavailable" ? transfer.input.uri : null,
        ).catch(() => null);
        if (resumed) await storeNativeSnapshot(batchId, resumed);
      }
      continue;
    }
  }

  nativeById = new Map((await listNativeTransfers()).map((snapshot) => [snapshot.transferId, snapshot]));
  let current = (await readBackgroundTransferBatches()).find((item) => item.id === batchId);
  if (!current) return;
  for (const group of current.groups) {
    const byId = new Map(current.transfers.map((transfer) => [transfer.transferId, transfer]));
    const grouped = group.transferIds.map((id) => byId.get(id)).filter((transfer): transfer is NonNullable<typeof transfer> => Boolean(transfer));
    if (grouped.length !== group.transferIds.length) throw new Error("Background attachment group is incomplete");
    const pending = grouped.filter((transfer) => transfer.status === "pending" && transfer.input.uri && !nativeById.has(transfer.transferId));
    if (!pending.length) continue;

    const bytesById = new Map<string, number>();
    for (const transfer of grouped) {
      const nativeBytes = nativeById.get(transfer.transferId)?.totalBytes;
      const storedBytes = transfer.declaredBytes;
      const bytes = Number.isSafeInteger(storedBytes) && Number(storedBytes) > 0
        ? Number(storedBytes)
        : Number.isSafeInteger(nativeBytes) && Number(nativeBytes) > 0
          ? Number(nativeBytes)
          : await localUploadBytes(transfer.input.uri);
      bytesById.set(transfer.transferId, bytes);
    }
    await mutateBackgroundTransferBatches((batches) => batches.map((item) => item.id !== batchId ? item : {
      ...item,
      updatedAt: Date.now(),
      transfers: item.transfers.map((transfer) => bytesById.has(transfer.transferId)
        ? { ...transfer, declaredBytes: bytesById.get(transfer.transferId)! }
        : transfer),
    }));

    const initialized = await api.initializeBackgroundMessageGroup({
      streamId: current.streamId,
      clientId: group.clientId,
      kind: current.messageKind,
      replyToId: group.replyToId,
      silent: current.silent,
      capabilityUploadIds: pending.map((transfer) => transfer.transferId),
      uploads: grouped.map((transfer) => ({ uploadId: transfer.transferId, input: transfer.input, bytes: bytesById.get(transfer.transferId)! })),
    });
    for (const session of initialized.sessions) {
      if (session.status === "complete" && session.attachment) {
        await mutateBackgroundTransferBatches((batches) => batches.map((item) => item.id === batchId
          ? applyInitializedAttachment(item, session.uploadId, session.attachment!)
          : item));
      }
    }

    current = (await readBackgroundTransferBatches()).find((item) => item.id === batchId);
    if (!current) return;
    for (const transfer of pending) {
      const live = current.transfers.find((item) => item.transferId === transfer.transferId);
      if (!live || live.status !== "pending" || !live.input.uri) continue;
      const session = initialized.sessions.find((item) => item.uploadId === transfer.transferId);
      if (session?.status === "complete") continue;
      if (!session?.upload) throw new Error("Upload server did not issue the requested transfer capability");
      const snapshot = await enqueueNativeTransfer({
        transferId: transfer.transferId,
        uploadId: transfer.transferId,
        apiBaseUrl: API_URL,
        capability: session.upload.capability,
        sourceUri: live.input.uri,
        declaredBytes: bytesById.get(transfer.transferId)!,
        chunkBytes: session.upload.chunkBytes,
        expiresAt: session.upload.expiresAt,
        allowMetered: live.input.allowMetered ?? true,
        createdAt: current.createdAt,
      });
      nativeById.set(transfer.transferId, snapshot);
      await storeNativeSnapshot(batchId, snapshot);
    }
    current = (await readBackgroundTransferBatches()).find((item) => item.id === batchId);
    if (!current) return;
  }
}

async function localUploadBytes(uri: string): Promise<number> {
  if (!uri) throw new Error("The selected file is no longer available");
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || typeof info.size !== "number" || !Number.isSafeInteger(info.size) || info.size <= 0) {
    throw new Error("The selected file is no longer available");
  }
  return info.size;
}

async function reconcileOnce(input: {
  ownerId: string;
  online: boolean;
  dispatchGroup: DispatchGroup;
  onProgress?: (batchId: string, progress: number) => void;
}): Promise<void> {
  let batches = await readBackgroundTransferBatches();
  for (const complete of batches.filter(batchComplete)) await cleanupCompletedBatch(complete);
  batches = await readBackgroundTransferBatches();
  const mismatched = batches.filter((batch) => batch.ownerId !== input.ownerId && !batchComplete(batch));
  await Promise.all(mismatched.map((batch) => cancelBackgroundBatch(batch.id)));
  batches = (await readBackgroundTransferBatches()).filter((batch) => batch.ownerId === input.ownerId);
  const snapshots = await listNativeTransfers();
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.transferId, snapshot]));
  await mutateBackgroundTransferBatches((current) => current.map((batch) => {
    if (batch.ownerId !== input.ownerId || batchComplete(batch)) return batch;
    let next = batch;
    for (const transfer of batch.transfers) {
      const snapshot = snapshotById.get(transfer.transferId);
      if (snapshot) next = applyNativeSnapshot(next, snapshot);
    }
    input.onProgress?.(batch.id, batchProgress(next));
    return next;
  }));

  if (input.online) {
    for (const batch of (await readBackgroundTransferBatches()).filter((item) => item.ownerId === input.ownerId && !batchComplete(item))) {
      if (batch.transfers.some((transfer) => transfer.status === "pending")) await schedulePendingTransfers(batch.id);
    }
  }

  if (!input.online) return;
  for (let batch of (await readBackgroundTransferBatches()).filter((item) => item.ownerId === input.ownerId && !batchFailed(item))) {
    for (const ready of readyAttachmentGroups(batch)) {
      const messageInput: MessageCreateInput = {
        clientId: ready.group.clientId,
        text: "",
        kind: batch.messageKind,
        replyToId: ready.group.replyToId,
        attachmentIds: ready.attachments.map((attachment) => attachment.id),
        silent: batch.silent,
      };
      await input.dispatchGroup({ batch, group: ready.group, attachments: ready.attachments, input: messageInput });
      const dispatchedAt = Date.now();
      await mutateBackgroundTransferBatches((current) => current.map((item) => item.id !== batch.id ? item : {
        ...item,
        updatedAt: dispatchedAt,
        groups: item.groups.map((group) => group.clientId === ready.group.clientId ? { ...group, dispatchedAt } : group),
      }));
      batch = (await readBackgroundTransferBatches()).find((item) => item.id === batch.id) ?? batch;
    }
    if (batchComplete(batch)) {
      await cleanupCompletedBatch(batch);
    }
  }
}

async function cleanupCompletedBatch(batch: QueuedAttachmentBatch): Promise<void> {
  // Message dispatch is already durably idempotent at this point. Native
  // terminal records are best-effort housekeeping and are independently
  // pruned, so a missing record must not pin a completed JS batch forever.
  await Promise.all(batch.transfers.map((transfer) => removeNativeTransfer(transfer.transferId).catch(() => false)));
  await forgetBackgroundBatch(batch.id);
}

async function forgetBackgroundBatch(batchId: string): Promise<void> {
  await mutateBackgroundTransferBatches((current) => current.filter((batch) => batch.id !== batchId));
}

async function storeNativeSnapshot(batchId: string, snapshot: NativeTransferSnapshot): Promise<void> {
  await mutateBackgroundTransferBatches((current) => current.map((batch) => batch.id === batchId ? applyNativeSnapshot(batch, snapshot) : batch));
  notifyWakeCallbacks();
}

function notifyWakeCallbacks() {
  for (const callback of wakeCallbacks) callback();
}

function waitForWake(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const callback = () => {
      clearTimeout(timer);
      wakeCallbacks.delete(callback);
      resolve();
    };
    const timer = setTimeout(callback, timeoutMs);
    wakeCallbacks.add(callback);
  });
}
