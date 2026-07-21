import type {
  ApiError,
  AppSettings,
  Attachment,
  BootstrapPayload,
  CursorPage,
  FriendEntry,
  Id,
  Message,
  MessageKind,
  SessionDevice,
  UploadQuality,
  UserSummary,
} from "@snezhok/contracts";

const explicitBase = import.meta.env.VITE_API_BASE?.replace(/\/$/, "");
const appBase = import.meta.env.BASE_URL.replace(/\/$/, "");
export const API_BASE = explicitBase || `${appBase}/api/v1`;

export class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, string[]> | undefined;

  constructor(status: number, payload: Partial<ApiError>) {
    super(payload.message || `Request failed (${status})`);
    this.name = "RequestError";
    this.status = status;
    this.code = payload.code || "request_failed";
    this.details = payload.details;
  }
}

const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;
let refreshInFlight: Promise<boolean> | null = null;
let authGeneration = 0;
let sessionController = new AbortController();

function resetSessionBoundary(): void {
  authGeneration += 1;
  sessionController.abort(new DOMException("Authentication session changed", "AbortError"));
  sessionController = new AbortController();
  refreshInFlight = null;
}

function terminalAuthFailure(): void {
  window.dispatchEvent(new Event("snezhok:auth-expired"));
}

async function fetchBounded(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(init.signal?.reason);
  if (init.signal) {
    if (init.signal.aborted) controller.abort(init.signal.reason);
    else init.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const generation = authGeneration;
  refreshInFlight = fetchBounded(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    credentials: "include",
    body: "{}",
    signal: sessionController.signal,
  }, REQUEST_TIMEOUT_MS)
    .then((response) => generation === authGeneration && response.ok)
    .catch(() => false)
    .finally(() => {
      if (generation === authGeneration) refreshInFlight = null;
    });
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, refreshed = false, sessionBound = true): Promise<T> {
  const generation = authGeneration;
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");

  const requestInit: RequestInit = {
    ...init,
    headers,
    credentials: "include",
    ...(sessionBound ? {
      signal: init.signal
        ? AbortSignal.any([init.signal, sessionController.signal])
        : sessionController.signal,
    } : {}),
  };
  const response = await fetchBounded(`${API_BASE}${path}`, requestInit, path.includes("/uploads/") ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  if (sessionBound && generation !== authGeneration) throw new DOMException("Authentication session changed", "AbortError");

  const refreshEligible = !["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"].includes(path);
  if (response.status === 401 && !refreshed && refreshEligible) {
    if (await refreshSession()) {
      if (generation !== authGeneration) throw new DOMException("Authentication session changed", "AbortError");
      return request<T>(path, init, true);
    }
    if (generation !== authGeneration) throw new DOMException("Authentication session changed", "AbortError");
    terminalAuthFailure();
  }
  if (response.status === 401 && refreshed && refreshEligible) terminalAuthFailure();

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: response.statusText })) as Partial<ApiError>;
    throw new RequestError(response.status, payload);
  }

  if (response.status === 204) return undefined as T;
  const payload = await response.json() as T;
  return normalizeResourceUrls(payload);
}

function normalizeResourceUrls<T>(value: T): T {
  if (typeof value === "string") {
    if (value.startsWith("/api/") && appBase) return `${appBase}${value}` as T;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeResourceUrls(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeResourceUrls(item)])) as T;
  }
  return value;
}

const json = (value: unknown) => JSON.stringify(value);
const streamPath = (streamId: Id) => `/streams/${encodeURIComponent(streamId)}`;

export interface AuthCredentials {
  username: string;
  password: string;
  email?: string;
}

export interface MessageSearchResult {
  messages: Message[];
  people: UserSummary[];
  files: Attachment[];
}

export interface UploadInput {
  file: File;
  kind: Attachment["kind"];
  quality: UploadQuality;
  stripLocation: boolean;
  purpose?: "standard" | "voice" | "video-note";
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface LiveKitCredentials {
  url: string;
  token: string;
  roomId: Id;
  callId: Id;
  roomName: string;
}

interface AuthResponse {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  user: UserSummary;
}

export const api = {
  login(input: AuthCredentials) {
    resetSessionBoundary();
    return request<AuthResponse>("/auth/login", {
      method: "POST",
      body: json({
        username: input.username,
        password: input.password,
        deviceName: navigator.userAgentData?.platform || navigator.platform || "Web browser",
        platform: "web",
      }),
    });
  },

  register(input: AuthCredentials) {
    resetSessionBoundary();
    return request<AuthResponse>("/auth/register", {
      method: "POST",
      body: json({
        username: input.username,
        password: input.password,
        email: input.email,
        deviceName: navigator.userAgentData?.platform || navigator.platform || "Web browser",
        platform: "web",
      }),
    });
  },

  me: () => request<{ user: UserSummary }>("/auth/me"),
  logout: () => {
    resetSessionBoundary();
    return request<void>("/auth/logout", { method: "POST" }, false, false);
  },
  bootstrap: () => request<BootstrapPayload>("/bootstrap"),

  messages(streamKind: "conversation" | "channel", streamId: Id, cursor?: string) {
    void streamKind;
    const query = cursor ? `?before=${encodeURIComponent(cursor)}&limit=50` : "?limit=50";
    return request<CursorPage<Message>>(`${streamPath(streamId)}/messages${query}`);
  },

  sendMessage(
    streamKind: "conversation" | "channel",
    streamId: Id,
    input: { clientId: Id; text: string; kind: MessageKind; replyToId: Id | null; attachmentIds: Id[] },
  ) {
    void streamKind;
    return request<{ message: Message }>(`${streamPath(streamId)}/messages`, {
      method: "POST",
      body: json(input),
    });
  },

  editMessage(messageId: Id, text: string) {
    return request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: json({ text }),
    });
  },

  forwardMessage(messageId: Id, targetStreamId: Id, clientId: Id) {
    return request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}/forward`, {
      method: "POST",
      body: json({ targetStreamId, clientId }),
    });
  },

  deleteMessage(messageId: Id) {
    return request<void>(`/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
  },

  react(messageId: Id, emoji: string, reacted: boolean) {
    return request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: "PUT",
      body: json({ emoji, active: !reacted }),
    });
  },

  pin(messageId: Id, pinned: boolean) {
    return request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}/pin`, {
      method: "PUT",
      body: json({ pinned: !pinned }),
    });
  },

  markRead(streamKind: "conversation" | "channel", streamId: Id, sequence: number) {
    void streamKind;
    return request<void>(`${streamPath(streamId)}/read`, {
      method: "POST",
      body: json({ sequence }),
    });
  },

  search(query: string, options: { streamId?: Id; scope?: "all" | "messages" | "media" | "files" | "links" } = {}) {
    const params = new URLSearchParams({ q: query });
    if (options.streamId) params.set("streamId", options.streamId);
    if (options.scope) params.set("scope", options.scope);
    return request<{ users: UserSummary[]; messages: Message[]; files: Attachment[] }>(`/search?${params}`).then((result) => ({
      people: result.users,
      messages: result.messages,
      files: result.files,
    }));
  },

  pinned(streamKind: "conversation" | "channel", streamId: Id) {
    void streamKind;
    return request<{ messages: Message[] }>(`${streamPath(streamId)}/pins`);
  },

  createConversation(participantIds: Id[], title?: string) {
    return request<{ conversation: { id: Id } }>("/conversations", {
      method: "POST",
      body: json(title === undefined ? { participantIds } : { participantIds, title }),
    }).then((result) => ({ conversationId: result.conversation.id }));
  },

  createServer(name: string) {
    return request<{ server: { id: Id; name: string }; channel: { id: Id } }>("/servers", {
      method: "POST",
      body: json({ name }),
    }).then((result) => ({ server: result.server, channelId: result.channel.id }));
  },

  createChannel(serverId: Id, input: { name: string; kind: "text" | "voice"; categoryId: Id | null; topic: string }) {
    return request<{ channel: { id: Id } }>(`/servers/${encodeURIComponent(serverId)}/channels`, {
      method: "POST",
      body: json(input),
    });
  },

  sendFriendRequest(username: string) {
    return request<{ entry: FriendEntry }>("/friends/requests", {
      method: "POST",
      body: json({ username }),
    });
  },

  respondFriendRequest(requestId: Id, accept: boolean) {
    return request<{ entry: FriendEntry }>(`/friends/requests/${encodeURIComponent(requestId)}/respond`, {
      method: "POST",
      body: json({ action: accept ? "accept" : "decline" }),
    });
  },

  cancelFriendRequest(requestId: Id) {
    return request<void>(`/friends/requests/${encodeURIComponent(requestId)}`, { method: "DELETE" });
  },

  removeFriend(userId: Id) {
    return request<void>(`/friends/${encodeURIComponent(userId)}`, { method: "DELETE" });
  },

  blockUser(userId: Id) {
    return request<{ entry: FriendEntry }>(`/friends/${encodeURIComponent(userId)}/block`, { method: "POST" });
  },

  unblockUser(userId: Id) {
    return request<void>(`/friends/${encodeURIComponent(userId)}/block`, { method: "DELETE" });
  },

  settings: {
    update(patch: Partial<AppSettings>) {
      return request<{ settings: AppSettings }>("/settings", { method: "PATCH", body: json(patch) });
    },
    sessions: () => request<{ sessions: SessionDevice[] }>("/auth/sessions"),
    revokeSession: (sessionId: Id) => request<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  },

  profile(patch: Partial<Pick<UserSummary, "displayName" | "bio" | "statusText">>) {
    return request<{ user: UserSummary }>("/users/me", { method: "PATCH", body: json(patch) }).then((result) => ({ me: result.user }));
  },

  deleteAccount(password: string) {
    return request<void>("/users/me", { method: "DELETE", body: json({ password }) });
  },

  serverMembers(serverId: Id) {
    return request<{ members: Array<{ user: UserSummary; role: "owner" | "admin" | "moderator" | "member"; roleIds: Id[]; joinedAt: number }> }>(`/servers/${encodeURIComponent(serverId)}/members`);
  },

  removeServerMember(serverId: Id, userId: Id) {
    return request<void>(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
  },

  async upload({ file, kind, quality, stripLocation, purpose = "standard", onProgress, signal }: UploadInput): Promise<Attachment> {
    const initialized = await request<{ uploadId: Id; upload: { id: Id; offset: number; chunkBytes: number; expiresAt: number } }>("/uploads/init", {
      method: "POST",
      body: json({ filename: file.name, mimeType: file.type || "application/octet-stream", bytes: file.size, kind, quality, stripLocation, purpose }),
      ...(signal ? { signal } : {}),
    });
    const chunkSize = Math.max(initialized.upload.chunkBytes, 1);
    const chunks = Math.max(1, Math.ceil(file.size / chunkSize));

    for (let index = 0; index < chunks; index += 1) {
      const start = index * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      await request<void>(`/uploads/${encodeURIComponent(initialized.uploadId)}/chunk`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/offset+octet-stream",
          "upload-offset": String(start),
        },
        body: file.slice(start, end),
        ...(signal ? { signal } : {}),
      });
      onProgress?.(Math.round(((index + 1) / chunks) * 100));
    }

    const completed = await request<{ attachment: Attachment }>(`/uploads/${encodeURIComponent(initialized.uploadId)}/complete`, {
      method: "POST",
      body: json({}),
      ...(signal ? { signal } : {}),
    });
    return completed.attachment;
  },

  callToken(roomId: Id, options: { video: boolean }) {
    return request<Omit<LiveKitCredentials, "roomId">>("/calls/token", {
      method: "POST",
      body: json({ roomId, streamId: roomId, video: options.video }),
    }).then((result) => ({ ...result, roomId }));
  },

  leaveCall(callId: Id) {
    return request<void>(`/calls/${encodeURIComponent(callId)}/leave`, { method: "POST" });
  },

  endCall(callId: Id) {
    return request<void>(`/calls/${encodeURIComponent(callId)}/end`, { method: "POST" });
  },
};

declare global {
  interface Navigator {
    userAgentData?: { platform?: string };
  }
}
