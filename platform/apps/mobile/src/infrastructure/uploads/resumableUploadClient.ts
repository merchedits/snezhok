import * as Crypto from "expo-crypto";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";

import {
  mutationAcknowledgementSchema,
  uploadInitResponseSchema,
  uploadResponseSchema,
} from "@snezhok/contracts";
import type { Attachment } from "@snezhok/contracts";

import { recordDiagnostic, recordPerformance } from "../../diagnostics/diagnostics";
import { API_URL } from "../http/apiConfig";
import {
  fetchWithTimeout,
  sessionTransport,
  type JsonRequestOptions,
  type ResponseDecoder,
} from "../http/sessionTransport";
import { ApiError } from "../../lib/apiError";
import { clearPendingUpload, rememberPendingUpload, reusablePendingUpload } from "../../lib/pendingUpload";
import { readSession, sessionOwnerId } from "../../lib/secureSession";
import {
  boundedUploadOffset,
  isUploadCancelled,
  MAX_UPLOAD_ATTEMPTS,
  retryableUploadStatus,
  uploadChunkBytes,
  UploadCancelledError,
  uploadRetryDelayMs,
  validateUploadSource,
} from "../../lib/uploadPolicy";
import { uploadPercent } from "../../lib/uploadProgress";
import { transferManager } from "../../transfers/transferManager";
import type { UploadInput, UploadProgressCallback, UploadInitResponse, UploadResponse } from "../../types";

type Request = <T>(path: string, options: JsonRequestOptions, decoder: ResponseDecoder) => Promise<T>;
type NativeUploadTask = ReturnType<typeof FileSystem.createUploadTask>;

interface ActiveUpload {
  uploadId: string | null;
  cancelled: boolean;
  task: NativeUploadTask | null;
}

/**
 * Owns the foreground resumable-upload protocol. It deliberately has no React
 * or Zustand dependency: callers observe one transfer ID and may safely leave
 * the originating screen while the operation continues.
 */
export class ResumableUploadClient {
  constructor(private readonly request: Request) {}

  async initialize(input: UploadInput): Promise<{ initialized: UploadInitResponse; bytes: number }> {
    const info = await FileSystem.getInfoAsync(input.uri);
    if (!info.exists || typeof info.size !== "number") throw new Error("The selected file is no longer available");
    validateUploadSource(input.filename, info.size);
    return { initialized: await this.initializeUpload(input, info.size), bytes: info.size };
  }

  cancelInitialized(uploadId: string): Promise<void> {
    return this.request(`/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" }, mutationAcknowledgementSchema).then(() => undefined);
  }

  async upload(input: UploadInput, onProgress?: UploadProgressCallback, transferId?: string): Promise<Attachment> {
    const ownerId = sessionOwnerId(await readSession());
    if (!ownerId) throw new Error("Your session has expired");
    const transfer = transferManager.begin({ id: transferId ?? Crypto.randomUUID(), ownerId, kind: "foreground-upload" });
    const active: ActiveUpload = { uploadId: null, cancelled: false, task: null };
    const removeCancelHandler = transfer.onCancel(async () => {
      active.cancelled = true;
      await active.task?.cancelAsync().catch(() => undefined);
      if (active.uploadId) {
        await this.request(`/uploads/${encodeURIComponent(active.uploadId)}`, { method: "DELETE" }, mutationAcknowledgementSchema).catch(() => undefined);
        await clearPendingUpload(active.uploadId);
      }
    });
    let lastProgress = -1;
    const reportProgress = (value: number) => {
      const progress = Math.max(lastProgress, Math.min(100, Math.max(0, Math.round(value))));
      if (progress === lastProgress) return;
      lastProgress = progress;
      transfer.updateProgress(progress);
      onProgress?.(progress);
    };
    const startedAt = performance.now();
    try {
      reportProgress(0);
      const info = await FileSystem.getInfoAsync(input.uri);
      if (!info.exists || typeof info.size !== "number") throw new Error("The selected file is no longer available");
      validateUploadSource(input.filename, info.size);
      let pending = await reusablePendingUpload(input, info.size, ownerId);
      let offset = 0;
      if (pending) {
        active.uploadId = pending.uploadId;
        try {
          offset = await this.uploadOffset(pending.uploadId);
        } catch (error) {
          if (!(error instanceof ApiError) || ![404, 409, 410].includes(error.status)) throw error;
          await clearPendingUpload(pending.uploadId);
          pending = null;
        }
      }
      if (!pending) {
        const initialized = await this.initializeUpload(input, info.size);
        active.uploadId = initialized.uploadId;
        pending = await rememberPendingUpload(input, info.size, initialized, ownerId);
        offset = initialized.upload.offset;
      }

      active.uploadId = pending.uploadId;
      if (active.cancelled) {
        await this.request(`/uploads/${encodeURIComponent(pending.uploadId)}`, { method: "DELETE" }, mutationAcknowledgementSchema).catch(() => undefined);
        await clearPendingUpload(pending.uploadId);
        throw new UploadCancelledError();
      }
      offset = boundedUploadOffset(offset, info.size);
      reportProgress(Math.min(96, Math.max(1, uploadPercent(offset, info.size))));
      await this.uploadNativeChunks(active, input.uri, info.size, offset, uploadChunkBytes(pending.chunkBytes), (uploaded) => {
        reportProgress(Math.min(96, Math.max(1, uploadPercent(uploaded, info.size))));
      });
      if (active.cancelled) throw new UploadCancelledError();
      reportProgress(97);
      const result = await this.completeUploadWithRetry(pending.uploadId, active);
      await clearPendingUpload(pending.uploadId);
      reportProgress(100);
      recordDiagnostic("info", "media", "Upload completed", { kind: input.kind, quality: input.quality, bytes: info.size, chunks: Math.ceil(info.size / uploadChunkBytes(pending.chunkBytes)) }, performance.now() - startedAt);
      transfer.complete();
      return result.attachment;
    } catch (error) {
      if (active.uploadId && error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 409 && error.status !== 425 && error.status !== 429) {
        await clearPendingUpload(active.uploadId);
      }
      recordDiagnostic(isUploadCancelled(error) ? "info" : "warn", "media", isUploadCancelled(error) ? "Upload cancelled" : "Upload failed", { kind: input.kind, error }, performance.now() - startedAt);
      if (!isUploadCancelled(error)) transfer.fail();
      throw error;
    } finally {
      active.task = null;
      removeCancelHandler();
      transferManager.clearTerminal();
    }
  }

  async cancel(transferId?: string): Promise<void> {
    if (transferId) {
      await transferManager.cancel(transferId);
      return;
    }
    await transferManager.cancelWhere((transfer) => transfer.kind === "foreground-upload");
  }

  private async uploadNativeChunks(active: ActiveUpload, uri: string, totalBytes: number, initialOffset: number, chunkBytes: number, onProgress: (uploaded: number) => void): Promise<void> {
    const source = new File(uri);
    const handle = source.open(FileMode.ReadOnly);
    const chunkDirectory = new Directory(Paths.cache, "snezhok-upload-chunks");
    chunkDirectory.create({ intermediates: true, idempotent: true });
    const chunkFile = new File(chunkDirectory, `${active.uploadId}.part`);
    let offset = initialOffset;
    try {
      while (offset < totalBytes) {
        if (active.cancelled) throw new UploadCancelledError();
        handle.offset = offset;
        const bytes = handle.readBytes(Math.min(chunkBytes, totalBytes - offset));
        if (!bytes.byteLength) throw new Error("The selected file ended before its declared size");
        chunkFile.create({ overwrite: true });
        chunkFile.write(bytes);
        const next = await this.uploadNativeChunk(active, chunkFile.uri, offset, bytes.byteLength, totalBytes, onProgress);
        if (next <= offset) throw new Error("The upload server did not advance the file offset");
        offset = boundedUploadOffset(next, totalBytes);
        onProgress(offset);
      }
    } finally {
      handle.close();
      if (chunkFile.exists) chunkFile.delete();
    }
  }

  private async uploadNativeChunk(active: ActiveUpload, uri: string, offset: number, length: number, totalBytes: number, onProgress: (uploaded: number) => void): Promise<number> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      if (active.cancelled) throw new UploadCancelledError();
      if (attempt > 0) await delay(uploadRetryDelayMs(attempt));
      try {
        const chunkStartedAt = performance.now();
        const response = await this.runNativeChunkTask(active, uri, offset, (sent) => onProgress(Math.min(totalBytes, offset + Math.min(length, sent))));
        recordPerformance("uploadChunk", performance.now() - chunkStartedAt, { bytes: length, attempt: attempt + 1, status: response.status });
        if (response.status === 401 && await sessionTransport.refreshSession()) continue;
        if (response.status === 409) return this.uploadOffset(active.uploadId!);
        if (response.status >= 200 && response.status < 300) {
          const headerOffset = Number(response.headers["upload-offset"] ?? response.headers["Upload-Offset"]);
          return Number.isSafeInteger(headerOffset) ? headerOffset : offset + length;
        }
        const payload = tryParseError(response.body);
        lastError = new ApiError(payload?.message ?? `Upload failed (${response.status})`, response.status);
        if (!retryableUploadStatus(response.status)) throw lastError;
      } catch (error) {
        if (active.cancelled || isUploadCancelled(error)) throw new UploadCancelledError();
        lastError = error;
        if (error instanceof ApiError && !retryableUploadStatus(error.status)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Upload failed after several attempts");
  }

  private async runNativeChunkTask(active: ActiveUpload, uri: string, offset: number, onProgress: (sent: number) => void) {
    const session = await readSession();
    if (!session) throw new Error("Your session has expired");
    const task = FileSystem.createUploadTask(
      `${API_URL}/uploads/${encodeURIComponent(active.uploadId!)}/chunk`,
      uri,
      {
        httpMethod: "PATCH",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": String(offset),
        },
      },
      ({ totalBytesSent }) => onProgress(totalBytesSent),
    );
    active.task = task;
    const response = await task.uploadAsync();
    active.task = null;
    if (!response) throw new UploadCancelledError();
    return response;
  }

  private async uploadOffset(uploadId: string, retry = true): Promise<number> {
    const session = await readSession();
    if (!session) throw new Error("Your session has expired");
    const response = await fetchWithTimeout(`${API_URL}/uploads/${encodeURIComponent(uploadId)}`, { method: "HEAD", headers: { Authorization: `Bearer ${session.accessToken}` } });
    if (response.status === 401 && retry && await sessionTransport.refreshSession()) return this.uploadOffset(uploadId, false);
    if (!response.ok) throw new ApiError(`Could not resume upload (${response.status})`, response.status);
    const offset = Number(response.headers.get("upload-offset"));
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Upload server returned an invalid offset");
    return offset;
  }

  private async completeUploadWithRetry(uploadId: string, active: ActiveUpload): Promise<UploadResponse> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      if (active.cancelled) throw new UploadCancelledError();
      if (attempt > 0) await delay(uploadRetryDelayMs(attempt));
      try {
        return await this.request<UploadResponse>(`/uploads/${uploadId}/complete`, { method: "POST", body: {} }, uploadResponseSchema);
      } catch (error) {
        lastError = error;
        if (error instanceof ApiError && !retryableUploadStatus(error.status)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Upload could not be finalized");
  }

  private initializeUpload(input: UploadInput, bytes: number): Promise<UploadInitResponse> {
    return this.request<UploadInitResponse>("/uploads/init", {
      method: "POST",
      body: {
        filename: input.filename,
        mimeType: input.mimeType,
        bytes,
        quality: input.quality,
        kind: input.kind,
        stripLocation: input.stripLocation ?? true,
        purpose: input.purpose ?? "standard",
      },
    }, uploadInitResponseSchema);
  }
}

function tryParseError(body: string): { message?: string } | null {
  try {
    const value = JSON.parse(body || "null") as unknown;
    return value && typeof value === "object" ? value as { message?: string } : null;
  } catch {
    return null;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
