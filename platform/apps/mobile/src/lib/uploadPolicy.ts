export const CLIENT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const LOW_END_UPLOAD_CHUNK_BYTES = 1024 * 1024;
export const MIN_UPLOAD_CHUNK_BYTES = 64 * 1024;
export const MAX_UPLOAD_ATTEMPTS = 4;

export function validateUploadSource(filename: string, bytes: number): void {
  if (!filename.trim() || filename.length > 255) throw new Error("The selected file has an invalid name");
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error("The selected file is empty or unreadable");
  if (bytes > CLIENT_MAX_UPLOAD_BYTES) throw new Error("The selected file exceeds the 2 GB upload limit");
}

export function uploadChunkBytes(serverChunkBytes: number): number {
  if (!Number.isSafeInteger(serverChunkBytes) || serverChunkBytes < MIN_UPLOAD_CHUNK_BYTES) return LOW_END_UPLOAD_CHUNK_BYTES;
  return Math.min(serverChunkBytes, LOW_END_UPLOAD_CHUNK_BYTES);
}

export function uploadRetryDelayMs(attempt: number): number {
  if (attempt <= 0) return 0;
  return Math.min(4_000, 350 * (2 ** (attempt - 1)));
}

export function retryableUploadStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function boundedUploadOffset(offset: number, totalBytes: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(totalBytes) || totalBytes < 0) return 0;
  return Math.min(offset, totalBytes);
}

export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelledError";
  }
}

export function isUploadCancelled(error: unknown): error is UploadCancelledError {
  return error instanceof UploadCancelledError;
}
