import Constants from "expo-constants";

import type { AppSettings, Attachment, BootstrapPayload, ConversationSummary, FriendEntry, Message, ServerSummary, UserSummary } from "@snezhok/contracts";

import type {
  AuthResponse,
  AndroidReleaseManifest,
  AuthTokens,
  CallJoinResponse,
  MessageCreateInput,
  MessagesResponse,
  UploadInput,
  UploadInitResponse,
  UploadResponse,
} from "../types";
import { clearSession, readSession, writeSession } from "./secureSession";

type RequestOptions = Omit<RequestInit, "body"> & { body?: BodyInit | object; authenticated?: boolean };

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
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? `Request failed (${response.status})`);
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

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.request<{ settings: AppSettings }>("/settings", { method: "PATCH", body: patch }).then((result) => result.settings);
  }

  async upload(input: UploadInput): Promise<Attachment> {
    const fileResponse = await fetch(input.uri);
    const blob = await fileResponse.blob();
    const initialized = await this.request<UploadInitResponse>("/uploads/init", {
      method: "POST",
      body: {
        filename: input.filename,
        mimeType: input.mimeType,
        bytes: blob.size,
        quality: input.quality,
        kind: input.kind,
        stripLocation: true,
      },
    });
    let offset = initialized.upload.offset;
    while (offset < blob.size) {
      const chunk = blob.slice(offset, Math.min(offset + initialized.upload.chunkBytes, blob.size));
      await this.request<void>(`/uploads/${initialized.uploadId}/chunk`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": String(offset),
        },
        body: chunk,
      });
      offset += chunk.size;
    }
    const result = await this.request<UploadResponse>(`/uploads/${initialized.uploadId}/complete`, { method: "POST" });
    return result.attachment;
  }

  joinCall(streamId: string): Promise<CallJoinResponse> {
    return this.request<CallJoinResponse>("/calls/token", { method: "POST", body: { streamId } });
  }

  searchUsers(query: string): Promise<UserSummary[]> {
    return this.request<{ users: UserSummary[] }>(`/users/search?q=${encodeURIComponent(query)}`).then((result) => result.users);
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

export function resolveApiResource(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const apiRoot = API_URL.replace(/\/api\/v1$/, "");
  return path.startsWith("/api/v1/") ? `${apiRoot}${path}` : `${API_URL}/${path.replace(/^\//, "")}`;
}
