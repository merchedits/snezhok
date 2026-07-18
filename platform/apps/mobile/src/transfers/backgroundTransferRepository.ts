import AsyncStorage from "@react-native-async-storage/async-storage";

import { batchComplete, type QueuedAttachmentBatch, type QueuedTransferStatus } from "./backgroundTransferModel";

const STORAGE_KEY = "@snezhok/background-transfers/v1";
const MAX_BATCHES = 24;
export const MAX_ACTIVE_TRANSFERS = 120;
let mutationQueue: Promise<void> = Promise.resolve();

export async function readBackgroundTransferBatches(): Promise<QueuedAttachmentBatch[]> {
  try {
    const parsed = JSON.parse(await AsyncStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validBatch).slice(0, MAX_BATCHES);
  } catch {
    return [];
  }
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
  return typeof batch.id === "string" && typeof batch.ownerId === "string" && typeof batch.streamId === "string"
    && ["media", "file", "video-note", "voice"].includes(String(batch.messageKind))
    && typeof batch.createdAt === "number" && Number.isFinite(batch.createdAt)
    && typeof batch.updatedAt === "number" && Number.isFinite(batch.updatedAt)
    && Array.isArray(batch.transfers) && batch.transfers.every(validTransfer)
    && Array.isArray(batch.groups) && batch.groups.every((group) => group && typeof group === "object"
      && typeof group.clientId === "string" && Array.isArray(group.transferIds)
      && group.transferIds.every((id) => typeof id === "string")
      && (group.replyToId === null || typeof group.replyToId === "string")
      && (group.dispatchedAt === null || Number.isFinite(group.dispatchedAt)));
}

const transferStatuses: readonly QueuedTransferStatus[] = ["pending", "staging", "queued", "running", "retrying", "succeeded", "failed", "cancelled"];

function validTransfer(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const transfer = value as QueuedAttachmentBatch["transfers"][number];
  return typeof transfer.transferId === "string" && Number.isInteger(transfer.position)
    && transferStatuses.includes(transfer.status) && Number.isFinite(transfer.progress)
    && transfer.progress >= 0 && transfer.progress <= 100
    && transfer.input && typeof transfer.input === "object" && typeof transfer.input.uri === "string"
    && typeof transfer.input.filename === "string" && typeof transfer.input.mimeType === "string";
}
