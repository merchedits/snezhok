import AsyncStorage from "@react-native-async-storage/async-storage";

import { recordDiagnostic } from "../diagnostics/diagnostics";
import { batchComplete, type QueuedAttachmentBatch, type QueuedTransferStatus } from "./backgroundTransferModel";

const STORAGE_KEY = "@snezhok/background-transfers/v1";
const MAX_BATCHES = 24;
export const MAX_ACTIVE_TRANSFERS = 120;
let mutationQueue: Promise<void> = Promise.resolve();
let lastCorruptionSignature = "";

export async function readBackgroundTransferBatches(): Promise<QueuedAttachmentBatch[]> {
  try {
    const parsed = JSON.parse(await AsyncStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      reportCorruption("invalid-root", 1);
      return [];
    }
    const valid = parsed.filter(validBatch).slice(0, MAX_BATCHES);
    const rejected = parsed.length - valid.length;
    if (rejected > 0) reportCorruption("invalid-batch", rejected);
    return valid;
  } catch {
    reportCorruption("invalid-json", 1);
    return [];
  }
}

function reportCorruption(reason: string, count: number): void {
  const signature = `${reason}:${count}`;
  if (signature === lastCorruptionSignature) return;
  lastCorruptionSignature = signature;
  recordDiagnostic("warn", "storage", "Invalid background transfer records were isolated", { reason, count });
}

export function mutateBackgroundTransferBatches(
  mutation: (current: QueuedAttachmentBatch[]) => QueuedAttachmentBatch[],
): Promise<QueuedAttachmentBatch[]> {
  let result: QueuedAttachmentBatch[] = [];
  mutationQueue = mutationQueue.catch(() => undefined).then(async () => {
    result = boundQueue(mutation(await readBackgroundTransferBatches()));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  });
  return mutationQueue.then(() => result);
}

export async function clearBackgroundTransferBatches(): Promise<void> {
  mutationQueue = mutationQueue.catch(() => undefined).then(() => AsyncStorage.removeItem(STORAGE_KEY));
  await mutationQueue;
}

function boundQueue(value: QueuedAttachmentBatch[]): QueuedAttachmentBatch[] {
  const deduplicated = [...new Map(value.map((batch) => [batch.id, batch])).values()]
    .sort((left, right) => right.updatedAt - left.updatedAt);
  // Never evict an active intent: doing so would orphan native work and lose
  // the stable message clientId needed for crash-safe dispatch. Capacity is
  // enforced before enqueue; only completed history is trimmed here.
  const active = deduplicated.filter((batch) => !batchComplete(batch));
  const completed = deduplicated.filter(batchComplete).slice(0, Math.max(0, MAX_BATCHES - active.length));
  return [...active, ...completed].sort((left, right) => right.updatedAt - left.updatedAt);
}

function validBatch(value: unknown): value is QueuedAttachmentBatch {
  if (!value || typeof value !== "object") return false;
  const batch = value as Partial<QueuedAttachmentBatch>;
  if (!(typeof batch.id === "string" && batch.id.length > 0 && typeof batch.ownerId === "string" && batch.ownerId.length > 0 && typeof batch.streamId === "string" && batch.streamId.length > 0
    && ["media", "file", "video-note", "voice"].includes(String(batch.messageKind))
    && typeof batch.createdAt === "number" && Number.isFinite(batch.createdAt)
    && typeof batch.updatedAt === "number" && Number.isFinite(batch.updatedAt)
    && Array.isArray(batch.transfers) && batch.transfers.every(validTransfer)
    && Array.isArray(batch.groups) && batch.groups.every((group) => group && typeof group === "object"
      && typeof group.clientId === "string" && Array.isArray(group.transferIds)
      && group.transferIds.every((id) => typeof id === "string")
      && (group.replyToId === null || typeof group.replyToId === "string")
      && (group.dispatchedAt === null || Number.isFinite(group.dispatchedAt))))) return false;
  const transferIds = batch.transfers.map((transfer) => transfer.transferId);
  const groupedIds = batch.groups.flatMap((group) => group.transferIds);
  return new Set(transferIds).size === transferIds.length
    && new Set(groupedIds).size === groupedIds.length
    && groupedIds.length === transferIds.length
    && groupedIds.every((id) => transferIds.includes(id));
}

const transferStatuses: readonly QueuedTransferStatus[] = ["pending", "staging", "queued", "running", "retrying", "succeeded", "failed", "cancelled"];

function validTransfer(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const transfer = value as QueuedAttachmentBatch["transfers"][number];
  return typeof transfer.transferId === "string" && Number.isInteger(transfer.position)
    && transferStatuses.includes(transfer.status) && Number.isFinite(transfer.progress)
    && transfer.progress >= 0 && transfer.progress <= 100
    && (transfer.declaredBytes === undefined || transfer.declaredBytes === null || (Number.isSafeInteger(transfer.declaredBytes) && transfer.declaredBytes > 0))
    && transfer.input && typeof transfer.input === "object" && typeof transfer.input.uri === "string"
    && typeof transfer.input.filename === "string" && typeof transfer.input.mimeType === "string";
}
