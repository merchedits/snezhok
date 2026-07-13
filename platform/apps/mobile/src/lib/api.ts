import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";

import type { AppSettings, Attachment, BootstrapPayload, ConversationSummary, FriendEntry, Message, ServerSummary, UserProfile, UserSummary } from "@snezhok/contracts";

import type {
  AuthResponse,
  AndroidReleaseManifest,
  AuthTokens,
  CallJoinResponse,
  MessageCreateInput,
  MessagesResponse,
  UploadInput,
  UploadInitResponse,
  UploadProgressCallback,
  UploadResponse,
} from "../types";
import { clearSession, readSession, writeSession } from "./secureSession";
import { uploadPercent } from "./uploadProgress";

type RequestOptions = Omit<RequestInit, "body"> & { body?: BodyInit | object; authenticated?: boolean };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const configuredUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;
export const API_URL = (configuredUrl ?? "https://merchedits.xyz/chat/api/v1").replace(/\/$/, "");

let refreshing: Promise<AuthTokens | null> | null = null;

class ApiClient {
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
    const { authenticated: authenticationOption, body: rawBody, ...fetchOptions } = options;
    const authenticated = authenticationOption !== false;
    const session = authenticated ? await readSession() : null;
    const isForm = typeof FormData !== "undefined" && rawBody instanceof FormData;
    const isBlob = typeof Blob !== "undefined" && rawBody instanceof Blob;
    const isRaw = typeof rawBody === "string" || isForm || isBlob || rawBody instanceof ArrayBuffer;
    const headers = new Headers(fetchOptions.headers);
    headers.set("Accept", "application/json");
    if (!isRaw && rawBody !== undefined) headers.set("Content-Type", "application/json");
    if (session?.accessToken) headers.set("Authorization", `Bearer ${session.accessToken}`);

    const init: RequestInit = { ...fetchOptions, headers };
    if (rawBody !== undefined) init.body = isRaw ? rawBody as BodyInit : JSON.stringify(rawBody);
    const response = await fetch(`${API_URL}${path}`, init);

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

  setReaction(messageId: string, emoji: string, active: boolean): Promise<Message> {
    return this.request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: "PUT",
      body: { emoji, active },
    }).then((result) => result.message);
  }

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.request<{ settings: AppSettings }>("/settings", { method: "PATCH", body: patch }).then((result) => result.settings);
  }

  async upload(input: UploadInput, onProgress?: UploadProgressCallback): Promise<Attachment> {
    let lastProgress = -1;
    const reportProgress = (value: number) => {
      const progress = Math.max(lastProgress, Math.min(100, Math.max(0, Math.round(value))));
      if (progress === lastProgress) return;
      lastProgress = progress;
      onProgress?.(progress);
    };
    reportProgress(0);
    const info = await FileSystem.getInfoAsync(input.uri);
    if (!info.exists || typeof info.size !== "number") throw new Error("The selected file is no longer available");
    const initialized = await this.request<UploadInitResponse>("/uploads/init", {
      method: "POST",
      body: {
        filename: input.filename,
        mimeType: input.mimeType,
        bytes: info.size,
        quality: input.quality,
        kind: input.kind,
        stripLocation: input.stripLocation ?? true,
        purpose: input.purpose ?? "standard",
      },
    });
    reportProgress(1);
    await this.uploadNativeFile(initialized.uploadId, input.uri, (sent, expected) => {
      reportProgress(Math.min(96, Math.max(1, uploadPercent(sent, expected))));
    });
    reportProgress(97);
    const result = await this.request<UploadResponse>(`/uploads/${initialized.uploadId}/complete`, { method: "POST" });
    reportProgress(100);
    return result.attachment;
  }

  private async uploadNativeFile(uploadId: string, uri: string, onProgress: (sent: number, expected: number) => void, retry = true): Promise<void> {
    const session = await readSession();
    if (!session) throw new Error("Your session has expired");
    const task = FileSystem.createUploadTask(
      `${API_URL}/uploads/${encodeURIComponent(uploadId)}/content`,
      uri,
      {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/octet-stream",
        },
      },
      ({ totalBytesSent, totalBytesExpectedToSend }) => onProgress(totalBytesSent, totalBytesExpectedToSend),
    );
    const response = await task.uploadAsync();
    if (!response) throw new Error("Upload was cancelled");
    if (response.status === 401 && retry && (await this.refresh())) return this.uploadNativeFile(uploadId, uri, onProgress, false);
    if (response.status < 200 || response.status >= 300) {
      const payload = tryParseError(response.body);
      throw new Error(payload?.message ?? `Upload failed (${response.status})`);
    }
  }

  joinCall(streamId: string): Promise<CallJoinResponse> {
    return this.request<CallJoinResponse>("/calls/token", { method: "POST", body: { streamId } });
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

function tryParseError(body: string): { message?: string } | null {
  try {
    const value = JSON.parse(body || "null") as unknown;
    return value && typeof value === "object" ? value as { message?: string } : null;
  } catch {
    return null;
  }
}

export function resolveApiResource(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const apiRoot = API_URL.replace(/\/api\/v1$/, "");
  return path.startsWith("/api/v1/") ? `${apiRoot}${path}` : `${API_URL}/${path.replace(/^\//, "")}`;
}
