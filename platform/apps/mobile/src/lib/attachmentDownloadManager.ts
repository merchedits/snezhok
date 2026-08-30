import { Directory, File, Paths } from "expo-file-system";

import { downloadAuthorizedMedia } from "./authorizedMediaDownload";

export interface AttachmentDownloadDescriptor { id: string; url: string; filename: string; bytes: number }
export interface AttachmentDownloadSnapshot { state: "idle" | "downloading" | "ready" | "failed" | "cancelled"; progress: number | null }
interface DownloadRecord { snapshot: AttachmentDownloadSnapshot; listeners: Set<() => void>; controller?: AbortController; promise?: Promise<File> }

const records = new Map<string, DownloadRecord>();
const downloadRoot = new Directory(Paths.document, "snezhok-downloads");

function recordFor(id: string): DownloadRecord {
  let record = records.get(id);
  if (!record) {
    record = { snapshot: { state: "idle", progress: null }, listeners: new Set() };
    records.set(id, record);
  }
  return record;
}

function setSnapshot(record: DownloadRecord, snapshot: AttachmentDownloadSnapshot) {
  record.snapshot = snapshot;
  for (const listener of record.listeners) listener();
}

function destinationFor(descriptor: AttachmentDownloadDescriptor): File {
  const safeName = descriptor.filename.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-100) || "attachment.bin";
  // Documents and explicitly downloaded media survive process restarts and OS
  // cache eviction. Account sign-out clears app-owned data separately.
  if (!downloadRoot.exists) downloadRoot.create({ idempotent: true, intermediates: true });
  return new File(downloadRoot, `snezhok-${descriptor.id}-${safeName}`);
}

export function clearAttachmentDownloads(): void {
  for (const record of records.values()) record.controller?.abort();
  records.clear();
  if (downloadRoot.exists) downloadRoot.delete();
}

export function getAttachmentDownloadSnapshot(id: string): AttachmentDownloadSnapshot {
  return recordFor(id).snapshot;
}

export function subscribeToAttachmentDownload(id: string, listener: () => void): () => void {
  const record = recordFor(id);
  record.listeners.add(listener);
  return () => record.listeners.delete(listener);
}

export function cancelAttachmentDownload(id: string) {
  recordFor(id).controller?.abort();
}

export async function ensureAttachmentDownloaded(descriptor: AttachmentDownloadDescriptor): Promise<File> {
  const record = recordFor(descriptor.id);
  const destination = destinationFor(descriptor);
  if (destination.exists && destination.size === descriptor.bytes) {
    setSnapshot(record, { state: "ready", progress: 1 });
    return destination;
  }
  if (record.promise) return record.promise;
  const controller = new AbortController();
  record.controller = controller;
  setSnapshot(record, { state: "downloading", progress: 0 });
  record.promise = downloadAuthorizedMedia(descriptor.url, destination, {
    signal: controller.signal,
    onProgress: ({ bytesWritten, totalBytes }) => setSnapshot(record, { state: "downloading", progress: totalBytes > 0 ? Math.max(0, Math.min(1, bytesWritten / totalBytes)) : null }),
  }).then((file) => {
    setSnapshot(record, { state: "ready", progress: 1 });
    return file;
  }).catch((error) => {
    setSnapshot(record, { state: controller.signal.aborted ? "cancelled" : "failed", progress: null });
    throw error;
  }).finally(() => {
    delete record.controller;
    delete record.promise;
  });
  return record.promise;
}
