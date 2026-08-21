import type { Attachment } from "@snezhok/contracts";

import type { NativeTransferSnapshot } from "../../modules/snezhok-background-transfer";
import type { UploadInput } from "../types";
import { decodeAttachmentValue } from "../domains/messaging/messageDecoding";

export type AttachmentMessageKind = "media" | "file" | "video-note" | "voice";
export type QueuedTransferStatus = "pending" | "staging" | "queued" | "running" | "retrying" | "succeeded" | "failed" | "cancelled";

export interface QueuedBackgroundTransfer {
  transferId: string;
  input: UploadInput;
  position: number;
  status: QueuedTransferStatus;
  progress: number;
  /** Persisted after group initialization so capability recovery never needs a pruned native row. */
  declaredBytes?: number | null;
  attachment: Attachment | null;
  errorCode: string | null;
}

export interface QueuedAttachmentGroup {
  clientId: string;
  transferIds: string[];
  replyToId: string | null;
  dispatchedAt: number | null;
}

export interface QueuedAttachmentBatch {
  id: string;
  ownerId: string;
  streamId: string;
  messageKind: AttachmentMessageKind;
  silent: boolean;
  createdAt: number;
  updatedAt: number;
  transfers: QueuedBackgroundTransfer[];
  groups: QueuedAttachmentGroup[];
}

export function attachmentGroupSize(messageKind: AttachmentMessageKind): number {
  return messageKind === "voice" || messageKind === "video-note" ? 1 : 10;
}

export function createAttachmentBatch(input: {
  id: string;
  ownerId: string;
  streamId: string;
  messageKind: AttachmentMessageKind;
  replyToId: string | null;
  silent?: boolean;
  inputs: UploadInput[];
  transferIds: string[];
  clientIds: string[];
  now?: number;
}): QueuedAttachmentBatch {
  if (!input.inputs.length || input.inputs.length !== input.transferIds.length) throw new Error("Invalid attachment batch");
  if ((input.messageKind === "voice" || input.messageKind === "video-note") && input.inputs.length !== 1) {
    throw new Error(`${input.messageKind} batches require exactly one attachment`);
  }
  // The message API accepts at most ten attachment IDs for every message kind.
  // Media and generic file selections therefore share the same deterministic
  // grouping rule, while voice and video notes remain strictly singular.
  const groupSize = attachmentGroupSize(input.messageKind);
  const groupCount = Math.ceil(input.inputs.length / groupSize);
  if (input.clientIds.length !== groupCount) throw new Error("Invalid attachment message identifiers");
  const now = input.now ?? Date.now();
  const transfers = input.inputs.map((upload, index): QueuedBackgroundTransfer => ({
    transferId: input.transferIds[index]!,
    input: upload,
    position: index,
    status: "pending",
    progress: 0,
    declaredBytes: null,
    attachment: null,
    errorCode: null,
  }));
  const groups = Array.from({ length: groupCount }, (_, groupIndex): QueuedAttachmentGroup => ({
    clientId: input.clientIds[groupIndex]!,
    transferIds: transfers.slice(groupIndex * groupSize, (groupIndex + 1) * groupSize).map((transfer) => transfer.transferId),
    replyToId: groupIndex === 0 ? input.replyToId : null,
    dispatchedAt: null,
  }));
  return {
    id: input.id,
    ownerId: input.ownerId,
    streamId: input.streamId,
    messageKind: input.messageKind,
    silent: input.silent ?? false,
    createdAt: now,
    updatedAt: now,
    transfers,
    groups,
  };
}

export function applyInitializedAttachment(
  batch: QueuedAttachmentBatch,
  transferId: string,
  attachment: Attachment,
): QueuedAttachmentBatch {
  let changed = false;
  const transfers = batch.transfers.map((transfer) => {
    if (transfer.transferId !== transferId) return transfer;
    changed = transfer.status !== "succeeded" || transfer.attachment?.id !== attachment.id || transfer.progress !== 100;
    return { ...transfer, status: "succeeded" as const, progress: 100, attachment, errorCode: null, input: { ...transfer.input, uri: "" } };
  });
  return changed ? { ...batch, transfers, updatedAt: Date.now() } : batch;
}

export function applyNativeSnapshot(batch: QueuedAttachmentBatch, snapshot: NativeTransferSnapshot): QueuedAttachmentBatch {
  const attachment = snapshot.status === "succeeded" && snapshot.resultJson
    ? parseAttachmentResult(snapshot.resultJson)
    : null;
  let changed = false;
  const transfers = batch.transfers.map((transfer) => {
    if (transfer.transferId !== snapshot.transferId) return transfer;
    const recoverableInvalidResult = snapshot.status === "succeeded" && !attachment && !transfer.attachment;
    const status = recoverableInvalidResult ? "pending" as const : snapshot.status;
    const errorCode = recoverableInvalidResult ? "invalid_result" : snapshot.errorCode;
    changed = transfer.status !== status || transfer.progress !== snapshot.progress
      || transfer.errorCode !== errorCode || (attachment !== null && transfer.attachment?.id !== attachment.id);
    return {
      ...transfer,
      status,
      progress: snapshot.progress,
      errorCode,
      attachment: attachment ?? transfer.attachment,
      ...(snapshot.status === "succeeded" && (attachment || transfer.attachment) ? { input: { ...transfer.input, uri: "" } } : {}),
    };
  });
  return changed ? { ...batch, transfers, updatedAt: Date.now() } : batch;
}

export function batchProgress(batch: QueuedAttachmentBatch): number {
  if (!batch.transfers.length) return 0;
  return Math.round(batch.transfers.reduce((sum, transfer) => sum + transfer.progress, 0) / batch.transfers.length);
}

export function batchFailed(batch: QueuedAttachmentBatch): boolean {
  return batch.transfers.some((transfer) => transfer.status === "failed" || transfer.status === "cancelled");
}

export function batchCancelled(batch: QueuedAttachmentBatch): boolean {
  return batch.transfers.length > 0 && batch.transfers.every((transfer) => transfer.status === "cancelled");
}

export function readyAttachmentGroups(batch: QueuedAttachmentBatch): Array<{ group: QueuedAttachmentGroup; attachments: Attachment[] }> {
  const transfers = new Map(batch.transfers.map((transfer) => [transfer.transferId, transfer]));
  return batch.groups.flatMap((group) => {
    if (group.dispatchedAt !== null) return [];
    const selected = group.transferIds.map((id) => transfers.get(id));
    if (selected.some((transfer) => !transfer?.attachment || transfer.status !== "succeeded")) return [];
    return [{ group, attachments: selected.map((transfer) => transfer!.attachment!) }];
  });
}

export function batchComplete(batch: QueuedAttachmentBatch): boolean {
  return batch.groups.every((group) => group.dispatchedAt !== null);
}

export function parseAttachmentResult(resultJson: string): Attachment | null {
  try {
    const parsed = JSON.parse(resultJson) as { attachment?: unknown };
    return decodeAttachmentValue(parsed.attachment);
  } catch {
    return null;
  }
}
