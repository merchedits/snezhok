import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";

import type { AppSettings, Attachment, BootstrapPayload, ConversationSummary, FriendEntry, Message, ServerSummary, UserProfile, UserSummary } from "@snezhok/contracts";

import type {
  AuthResponse,
  AndroidReleaseManifest,
  AuthTokens,
  CallJoinResponse,
  ChatFolder,
  MessageCreateInput,
  MessagesResponse,
  ProductivityPayload,
  ScheduledMessage,
  UploadInput,
  UploadInitResponse,
  UploadProgressCallback,
  UploadResponse,
} from "../types";
import { recordDiagnostic, recordPerformance } from "../diagnostics/diagnostics";
import type { DiagnosticReport } from "../diagnostics/diagnostics";
import { ApiError } from "./apiError";
import { clearPendingUpload, rememberPendingUpload, reusablePendingUpload } from "./pendingUpload";
import { clearSession, readSession, writeSession } from "./secureSession";
import {
  boundedUploadOffset,
  isUploadCancelled,
  MAX_UPLOAD_ATTEMPTS,
  retryableUploadStatus,
  uploadChunkBytes,
  UploadCancelledError,
  uploadRetryDelayMs,
  validateUploadSource,
} from "./uploadPolicy";
import { uploadPercent } from "./uploadProgress";

export { ApiError } from "./apiError";

type RequestOptions = Omit<RequestInit, "body"> & { body?: BodyInit | object; authenticated?: boolean };

const configuredUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;
export const API_URL = (configuredUrl ?? "https://merchedits.xyz/chat/api/v1").replace(/\/$/, "");

let refreshing: Promise<AuthTokens | null> | null = null;

type NativeUploadTask = ReturnType<typeof FileSystem.createUploadTask>;
interface ActiveUpload {
  uploadId: string | null;
  cancelled: boolean;
  task: NativeUploadTask | null;
}

class ApiClient {
  private activeUpload: ActiveUpload | null = null;

  private async refresh(): Promise<AuthTokens | null> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const current = await readSession();
      if (!current) return null;
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!response.ok) {
        if (response.status === 400 || response.status === 401 || response.status === 403) await clearSession();
        return null;
      }
      const result = (await response.json()) as AuthResponse;
      const tokens: AuthTokens = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: Date.now() + result.expiresIn * 1_000,
      };
      await writeSession(tokens);
      return tokens;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  private async request<T>(path: string, options: RequestOptions = {}, retry = true): Promise<T> {
    const startedAt = performance.now();
    const requestId = Crypto.randomUUID();
    const { authenticated: authenticationOption, body: rawBody, ...fetchOptions } = options;
    const authenticated = authenticationOption !== false;
    const session = authenticated ? await readSession() : null;
    const isForm = typeof FormData !== "undefined" && rawBody instanceof FormData;
    const isBlob = typeof Blob !== "undefined" && rawBody instanceof Blob;
    const isRaw = typeof rawBody === "string" || isForm || isBlob || rawBody instanceof ArrayBuffer;
    const headers = new Headers(fetchOptions.headers);
    headers.set("Accept", "application/json");
    headers.set("X-Request-ID", requestId);
    if (!isRaw && rawBody !== undefined) headers.set("Content-Type", "application/json");
    if (session?.accessToken) headers.set("Authorization", `Bearer ${session.accessToken}`);

    const init: RequestInit = { ...fetchOptions, headers };
    if (rawBody !== undefined) init.body = isRaw ? rawBody as BodyInit : JSON.stringify(rawBody);
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, init);
    } catch (error) {
      recordDiagnostic("error", "network", "API request could not reach the server", { path: path.split("?", 1)[0], method: init.method ?? "GET", requestId, error }, performance.now() - startedAt);
      throw error;
    }

    recordDiagnostic(response.ok ? "debug" : response.status >= 500 ? "error" : "warn", "network", "API request completed", {
      path: path.split("?", 1)[0],
      method: init.method ?? "GET",
      status: response.status,
      requestId: response.headers.get("x-request-id") ?? requestId,
    }, performance.now() - startedAt);

    if (response.status === 401 && authenticated && retry && (await this.refresh())) {
      return this.request<T>(path, options, false);
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { code?: string; message?: string; details?: Record<string, string[]> } | null;
      throw new ApiError(payload?.message ?? `Request failed (${response.status})`, response.status, payload?.code, payload?.details);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  login(username: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>("/auth/login", {
      method: "POST",
      authenticated: false,
      body: { username, password, deviceName: "Snezhok for Android", platform: "android" },
    });
  }

  register(input: { email: string; username: string; password: string }): Promise<AuthResponse> {
    return this.request<AuthResponse>("/auth/register", {
      method: "POST",
      authenticated: false,
      body: { ...input, deviceName: "Snezhok for Android", platform: "android" },
    });
  }

  bootstrap(): Promise<BootstrapPayload> {
    return this.request<BootstrapPayload>("/bootstrap");
  }

  androidRelease(): Promise<AndroidReleaseManifest> {
    return this.request<AndroidReleaseManifest>("/client/android/manifest", { authenticated: false });
  }

  messages(streamId: string, before?: number): Promise<MessagesResponse> {
    const query = new URLSearchParams({ limit: "60" });
    if (before !== undefined) query.set("before", String(before));
    return this.request<MessagesResponse>(`/streams/${encodeURIComponent(streamId)}/messages?${query}`);
  }

  markRead(streamId: string, sequence: number): Promise<{ streamId: string; userId: string; sequence: number }> {
    return this.request(`/streams/${encodeURIComponent(streamId)}/read`, {
      method: "POST",
      body: { sequence },
    });
  }

  markUnread(streamId: string, sequence?: number): Promise<{ streamId: string; userId: string; sequence: number; markedUnread: true }> {
    return this.request(`/streams/${encodeURIComponent(streamId)}/unread`, {
      method: "POST",
      ...(sequence === undefined ? {} : { body: { sequence } }),
    });
  }

  pinnedMessages(streamId: string): Promise<Message[]> {
    return this.request<{ messages: Message[] }>(`/streams/${encodeURIComponent(streamId)}/pins`).then((result) => result.messages);
  }

  messageContext(messageId: string): Promise<{ streamId: string; targetId: string; items: Message[] }> {
    return this.request(`/messages/${encodeURIComponent(messageId)}/context?limit=60`);
  }

  createMessage(streamId: string, input: MessageCreateInput): Promise<Message> {
    return this.request<{ message: Message }>(`/streams/${encodeURIComponent(streamId)}/messages`, {
      method: "POST",
      body: input,
    }).then((result) => result.message);
  }

  forwardMessage(messageId: string, targetStreamId: string, clientId: string): Promise<Message> {
    return this.request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}/forward`, {
      method: "POST",
      body: { targetStreamId, clientId },
    }).then((result) => result.message);
  }

  editMessage(messageId: string, text: string): Promise<Message> {
    return this.request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: { text },
    }).then((result) => result.message);
  }

  setReaction(messageId: string, emoji: string, active: boolean): Promise<Message> {
    return this.request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: "PUT",
      body: { emoji, active },
    }).then((result) => result.message);
  }

  deleteMessage(messageId: string): Promise<Message> {
    return this.request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}?scope=everyone`, {
      method: "DELETE",
    }).then((result) => result.message);
  }

  hideMessage(messageId: string): Promise<{ id: string; streamId: string }> {
    return this.request<{ hidden: { id: string; streamId: string } }>(`/messages/${encodeURIComponent(messageId)}?scope=me`, {
      method: "DELETE",
    }).then((result) => result.hidden);
  }

  setMessagePinned(messageId: string, pinned: boolean): Promise<Message> {
    return this.request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}/pin`, {
      method: "PUT",
      body: { pinned },
    }).then((result) => result.message);
  }

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.request<{ settings: AppSettings }>("/settings", { method: "PATCH", body: patch }).then((result) => result.settings);
  }

  async initializeBackgroundUpload(input: UploadInput): Promise<{ initialized: UploadInitResponse; bytes: number }> {
    const info = await FileSystem.getInfoAsync(input.uri);
    if (!info.exists || typeof info.size !== "number") throw new Error("The selected file is no longer available");
    validateUploadSource(input.filename, info.size);
    return { initialized: await this.initializeUpload(input, info.size), bytes: info.size };
  }

  cancelInitializedUpload(uploadId: string): Promise<void> {
    return this.request(`/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" }).then(() => undefined);
  }

  async upload(input: UploadInput, onProgress?: UploadProgressCallback): Promise<Attachment> {
    if (this.activeUpload) throw new Error("Another upload is already running");
    const active: ActiveUpload = { uploadId: null, cancelled: false, task: null };
    this.activeUpload = active;
    let lastProgress = -1;
    const reportProgress = (value: number) => {
      const progress = Math.max(lastProgress, Math.min(100, Math.max(0, Math.round(value))));
      if (progress === lastProgress) return;
      lastProgress = progress;
      onProgress?.(progress);
    };
    const startedAt = performance.now();
    try {
      reportProgress(0);
      const info = await FileSystem.getInfoAsync(input.uri);
      if (!info.exists || typeof info.size !== "number") throw new Error("The selected file is no longer available");
      validateUploadSource(input.filename, info.size);

      let pending = await reusablePendingUpload(input, info.size);
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
        pending = await rememberPendingUpload(input, info.size, initialized);
        offset = initialized.upload.offset;
      }

      active.uploadId = pending.uploadId;
      if (active.cancelled) {
        await this.request(`/uploads/${encodeURIComponent(pending.uploadId)}`, { method: "DELETE" }).catch(() => undefined);
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
      return result.attachment;
    } catch (error) {
      if (active.uploadId && error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 409 && error.status !== 425 && error.status !== 429) {
        await clearPendingUpload(active.uploadId);
      }
      recordDiagnostic(isUploadCancelled(error) ? "info" : "warn", "media", isUploadCancelled(error) ? "Upload cancelled" : "Upload failed", { kind: input.kind, error }, performance.now() - startedAt);
      throw error;
    } finally {
      active.task = null;
      if (this.activeUpload === active) this.activeUpload = null;
    }
  }

  async cancelUpload(): Promise<void> {
    const active = this.activeUpload;
    if (!active) return;
    active.cancelled = true;
    await active.task?.cancelAsync().catch(() => undefined);
    if (active.uploadId) {
      await this.request(`/uploads/${encodeURIComponent(active.uploadId)}`, { method: "DELETE" }).catch(() => undefined);
      await clearPendingUpload(active.uploadId);
    }
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
        if (response.status === 401 && await this.refresh()) continue;
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
    const response = await fetch(`${API_URL}/uploads/${encodeURIComponent(uploadId)}`, { method: "HEAD", headers: { Authorization: `Bearer ${session.accessToken}` } });
    if (response.status === 401 && retry && await this.refresh()) return this.uploadOffset(uploadId, false);
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
        return await this.request<UploadResponse>(`/uploads/${uploadId}/complete`, { method: "POST" });
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
    });
  }

  joinCall(streamId: string): Promise<CallJoinResponse> {
    return this.request<CallJoinResponse>("/calls/token", { method: "POST", body: { streamId } });
  }

  endCall(callId: string): Promise<void> {
    return this.request(`/calls/${encodeURIComponent(callId)}/end`, { method: "POST" }).then(() => undefined);
  }

  leaveCall(callId: string): Promise<void> {
    return this.request(`/calls/${encodeURIComponent(callId)}/leave`, { method: "POST" }).then(() => undefined);
  }

  declineCall(callId: string): Promise<void> {
    return this.request(`/calls/${encodeURIComponent(callId)}/decline`, { method: "POST" }).then(() => undefined);
  }

  registerPushDevice(token: string, installationId: string, appVersion: string): Promise<{ registered: true }> {
    return this.request("/notifications/devices", { method: "POST", body: { token, installationId, appVersion, platform: "android" } });
  }

  unregisterPushDevice(installationId: string): Promise<void> {
    return this.request(`/notifications/devices/${encodeURIComponent(installationId)}`, { method: "DELETE" });
  }

  diagnosticHealth(): Promise<DiagnosticHealth> {
    return this.request<DiagnosticHealth>("/diagnostics/health");
  }

  sendDiagnosticReport(report: DiagnosticReport): Promise<{ accepted: true; requestId: string }> {
    return this.request("/diagnostics/client-reports", { method: "POST", body: report });
  }

  searchUsers(query: string): Promise<UserSummary[]> {
    return this.request<{ users: UserSummary[] }>(`/users/search?q=${encodeURIComponent(query)}`).then((result) => result.users);
  }

  profile(userId: string): Promise<UserProfile> {
    return this.request<{ profile: UserProfile }>(`/users/${encodeURIComponent(userId)}/profile`).then((result) => result.profile);
  }

  updateProfile(input: { displayName?: string; bio?: string; statusText?: string }): Promise<UserSummary> {
    return this.request<{ user: UserSummary }>("/users/me", { method: "PATCH", body: input }).then((result) => result.user);
  }

  addProfilePhoto(attachmentId: string): Promise<UserProfile> {
    return this.request<{ profile: UserProfile }>("/users/me/profile-photos", { method: "POST", body: { attachmentId } }).then((result) => result.profile);
  }

  reorderProfilePhotos(attachmentIds: string[]): Promise<UserProfile> {
    return this.request<{ profile: UserProfile }>("/users/me/profile-photos/order", { method: "PATCH", body: { attachmentIds } }).then((result) => result.profile);
  }

  removeProfilePhoto(attachmentId: string): Promise<UserProfile> {
    return this.request<{ profile: UserProfile }>(`/users/me/profile-photos/${encodeURIComponent(attachmentId)}`, { method: "DELETE" }).then((result) => result.profile);
  }

  createConversation(participantIds: string[], title?: string): Promise<ConversationSummary> {
    return this.request<{ conversation: ConversationSummary }>("/conversations", {
      method: "POST",
      body: title ? { participantIds, title } : { participantIds },
    }).then((result) => result.conversation);
  }

  deleteConversation(conversationId: string): Promise<void> {
    return this.request(`/conversations/${encodeURIComponent(conversationId)}/members/me`, { method: "DELETE" }).then(() => undefined);
  }

  updateConversationPreferences(conversationId: string, patch: { pinned?: boolean; archived?: boolean; muted?: boolean }): Promise<ConversationSummary> {
    return this.request<{ conversation: ConversationSummary }>(`/conversations/${encodeURIComponent(conversationId)}/preferences`, { method: "PATCH", body: patch })
      .then((result) => result.conversation);
  }

  search(query: string, streamId?: string, scope: "all" | "messages" | "media" | "files" | "links" = "all"): Promise<{ users: UserSummary[]; messages: Message[]; files: Array<{ id: string; filename: string; kind: string; bytes: number; url: string }> }> {
    const params = new URLSearchParams({ q: query, scope, limit: "50" });
    if (streamId) params.set("streamId", streamId);
    return this.request(`/search?${params}`);
  }

  productivity(): Promise<ProductivityPayload> {
    return this.request("/productivity");
  }

  saveDraft(streamId: string, text: string, replyToId: string | null): Promise<void> {
    return this.request(`/streams/${encodeURIComponent(streamId)}/draft`, { method: "PUT", body: { text, replyToId } }).then(() => undefined);
  }

  scheduleMessage(streamId: string, input: MessageCreateInput, scheduledFor: number): Promise<ScheduledMessage> {
    return this.request<{ scheduled: ScheduledMessage }>(`/streams/${encodeURIComponent(streamId)}/scheduled`, {
      method: "POST",
      body: { ...input, scheduledFor },
    }).then((result) => result.scheduled);
  }

  createFolder(name: string, streams: ChatFolder["streams"] = []): Promise<ChatFolder> {
    return this.request<{ folder: ChatFolder }>("/folders", { method: "POST", body: { name, includeArchived: false, streams } }).then((result) => result.folder);
  }

  updateFolder(folderId: string, patch: Partial<Pick<ChatFolder, "name" | "includeArchived" | "streams">>): Promise<ChatFolder> {
    return this.request<{ folder: ChatFolder }>(`/folders/${encodeURIComponent(folderId)}`, { method: "PATCH", body: patch }).then((result) => result.folder);
  }

  deleteFolder(folderId: string): Promise<void> {
    return this.request(`/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" }).then(() => undefined);
  }

  cancelScheduledMessage(scheduledMessageId: string): Promise<void> {
    return this.request(`/scheduled/${encodeURIComponent(scheduledMessageId)}`, { method: "DELETE" }).then(() => undefined);
  }

  createServer(name: string): Promise<ServerSummary> {
    return this.request<{ server: ServerSummary }>("/servers", { method: "POST", body: { name } }).then((result) => result.server);
  }

  requestFriend(username: string): Promise<FriendEntry> {
    return this.request<{ entry: FriendEntry }>("/friends/requests", { method: "POST", body: { username } }).then((result) => result.entry);
  }

  respondFriend(requestId: string, action: "accept" | "decline"): Promise<FriendEntry> {
    return this.request<{ entry: FriendEntry }>(`/friends/requests/${encodeURIComponent(requestId)}/respond`, { method: "POST", body: { action } }).then((result) => result.entry);
  }
}

export const api = new ApiClient();

export interface DiagnosticHealth {
  status: "ok";
  requestId: string;
  databaseLatencyMs: number;
  databasePool: { total: number; idle: number; waiting: number };
  process: { uptimeSeconds: number; rssBytes: number; heapUsedBytes: number };
  checkedAt: number;
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

export function resolveApiResource(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const apiRoot = API_URL.replace(/\/api\/v1$/, "");
  return path.startsWith("/api/v1/") ? `${apiRoot}${path}` : `${API_URL}/${path.replace(/^\//, "")}`;
}
