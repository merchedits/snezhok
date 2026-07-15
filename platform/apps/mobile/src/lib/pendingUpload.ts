import AsyncStorage from "@react-native-async-storage/async-storage";

import type { UploadInput, UploadInitResponse } from "../types";

const PENDING_UPLOAD_KEY = "@snezhok/upload/pending/v1";

export interface PendingUpload {
  uploadId: string;
  uri: string;
  filename: string;
  bytes: number;
  chunkBytes: number;
  expiresAt: number;
}

export async function reusablePendingUpload(input: UploadInput, bytes: number): Promise<PendingUpload | null> {
  const pending = await readPendingUpload();
  if (!pending) return null;
  if (pending.expiresAt <= Date.now() + 30_000 || pending.uri !== input.uri || pending.filename !== input.filename || pending.bytes !== bytes) {
    await clearPendingUpload();
    return null;
  }
  return pending;
}

export async function rememberPendingUpload(input: UploadInput, bytes: number, initialized: UploadInitResponse): Promise<PendingUpload> {
  const pending: PendingUpload = {
    uploadId: initialized.uploadId,
    uri: input.uri,
    filename: input.filename,
    bytes,
    chunkBytes: initialized.upload.chunkBytes,
    expiresAt: initialized.upload.expiresAt,
  };
  await AsyncStorage.setItem(PENDING_UPLOAD_KEY, JSON.stringify(pending));
  return pending;
}

export async function clearPendingUpload(uploadId?: string): Promise<void> {
  if (uploadId) {
    const current = await readPendingUpload();
    if (current && current.uploadId !== uploadId) return;
  }
  await AsyncStorage.removeItem(PENDING_UPLOAD_KEY);
}

async function readPendingUpload(): Promise<PendingUpload | null> {
  try {
    const value = JSON.parse(await AsyncStorage.getItem(PENDING_UPLOAD_KEY) ?? "null") as Partial<PendingUpload> | null;
    if (!value || typeof value.uploadId !== "string" || typeof value.uri !== "string" || typeof value.filename !== "string"
      || !Number.isSafeInteger(value.bytes) || !Number.isSafeInteger(value.chunkBytes) || typeof value.expiresAt !== "number") return null;
    return value as PendingUpload;
  } catch {
    return null;
  }
}
