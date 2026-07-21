import type {
  ChannelCategory, ChannelPermissionOverride, ChannelSummary, ConversationSummary, MemberRole,
  Message, NotificationPolicy, PrivacySettings, ServerAuditEntry,
  ServerNotificationPolicy, ServerPermission, ServerRoleDefinition, ServerSummary,
  SessionDevice, StreamNotificationPolicy, UserSummary,
} from "@snezhok/contracts";

import { API_URL } from "./api";
import { ApiError } from "./apiError";
import { clearSession, clearSessionIfCurrent, getRuntimeSession, getSessionGeneration, readSession, sessionOwnerId, writeSessionIfCurrent } from "./secureSession";

type GroupRole = "owner" | "admin" | "member";
export interface GroupMember { user: UserSummary; role: GroupRole; joinedAt: number }
export interface ServerBan { user: UserSummary; reason: string; bannedBy: string | null; createdAt: number }
export interface ServerMemberView { user: UserSummary; role: MemberRole; roleIds: string[]; joinedAt: number }
export interface ServerAuthorizationView { role: MemberRole; permissions: ServerPermission[]; rank: number }
export interface ServerDetails { server: ServerSummary; authorization: ServerAuthorizationView }

type JsonOptions = Omit<RequestInit, "body"> & { body?: unknown };
let refreshInFlight: Promise<boolean> | null = null;
const REQUEST_TIMEOUT_MS = 20_000;

async function fetchBounded(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(init.signal?.reason);
  if (init.signal) {
    if (init.signal.aborted) controller.abort(init.signal.reason);
    else init.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), REQUEST_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); init.signal?.removeEventListener("abort", onAbort); }
}

async function request<T>(path: string, options: JsonOptions = {}, retry = true): Promise<T> {
  const session = await readSession();
  if (!session) throw new ApiError("Session expired", 401, "UNAUTHORIZED");
  const requestOwnerId = sessionOwnerId(session);
  const { body, headers: headerInit, ...requestOptions } = options;
  const headers = new Headers(headerInit);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetchBounded(`${API_URL}${path}`, {
    ...requestOptions,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (requestOwnerId !== sessionOwnerId(getRuntimeSession())) {
    throw new ApiError("Account changed while the request was in progress", 401, "SESSION_CHANGED");
  }
  if (response.status === 401 && retry && await refreshSession()) return request<T>(path, options, false);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string; code?: string; details?: Record<string, string[]> } | null;
    throw new ApiError(payload?.message ?? `Request failed (${response.status})`, response.status, payload?.code, payload?.details);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const sessionGeneration = getSessionGeneration();
    const current = await readSession();
    if (!current) return false;
    const response = await fetchBounded(`${API_URL}/auth/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    if (!response.ok) { await clearSessionIfCurrent(sessionGeneration); return false; }
    const result = await response.json() as { accessToken: string; refreshToken: string; expiresIn: number };
    return writeSessionIfCurrent(
      { accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: Date.now() + result.expiresIn * 1_000, ...(current.ownerId ? { ownerId: current.ownerId } : {}) },
      sessionGeneration,
    );
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export const productApi = {
  sessions: () => request<{ sessions: SessionDevice[] }>("/auth/sessions").then((value) => value.sessions),
  revokeSession: (id: string) => request<{ success: true; current: boolean }>(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  revokeOtherSessions: () => request<{ revoked: number }>("/auth/sessions/revoke-others", { method: "POST" }),
  deleteAccount: async (password: string) => { await request("/users/me", { method: "DELETE", body: { password, confirmation: "DELETE" } }); await clearSession(); },

  privacy: () => request<{ privacy: PrivacySettings }>("/users/me/privacy").then((value) => value.privacy),
  updatePrivacy: (patch: Partial<PrivacySettings>) => request<{ privacy: PrivacySettings }>("/users/me/privacy", { method: "PATCH", body: patch }).then((value) => value.privacy),
  blockUser: (id: string) => request(`/friends/${encodeURIComponent(id)}/block`, { method: "POST" }),
  unblockUser: (id: string) => request(`/friends/${encodeURIComponent(id)}/block`, { method: "DELETE" }),

  createGroup: (participantIds: string[], title: string) => request<{ conversation: ConversationSummary }>("/conversations", { method: "POST", body: { participantIds, title } }).then((value) => value.conversation),
  updateGroup: (id: string, patch: { title?: string; avatarAttachmentId?: string | null }) => request<{ conversation: ConversationSummary }>(`/conversations/${id}`, { method: "PATCH", body: patch }).then((value) => value.conversation),
  groupMembers: (id: string) => request<{ members: GroupMember[] }>(`/conversations/${id}/members`).then((value) => value.members),
  addGroupMember: (id: string, userId: string, role: "admin" | "member" = "member") => request(`/conversations/${id}/members`, { method: "POST", body: { userId, role } }),
  setGroupMemberRole: (id: string, userId: string, role: "admin" | "member") => request(`/conversations/${id}/members/${userId}`, { method: "PATCH", body: { role } }),
  removeGroupMember: (id: string, userId: string) => request(`/conversations/${id}/members/${userId}`, { method: "DELETE" }),
  transferGroup: (id: string, userId: string) => request(`/conversations/${id}/ownership`, { method: "POST", body: { userId } }),
  leaveGroup: (id: string) => request(`/conversations/${id}/members/me`, { method: "DELETE" }),

  server: (id: string) => request<ServerDetails>(`/servers/${id}`),
  updateServer: (id: string, patch: { name?: string; iconAttachmentId?: string | null }) => request<{ server: ServerSummary }>(`/servers/${id}`, { method: "PATCH", body: patch }).then((value) => value.server),
  deleteServer: (id: string) => request(`/servers/${id}`, { method: "DELETE" }),
  transferServer: (id: string, userId: string) => request(`/servers/${id}/ownership`, { method: "POST", body: { userId } }),
  leaveServer: (id: string, userId: string) => request(`/servers/${id}/members/${userId}`, { method: "DELETE" }),
  serverMembers: (id: string) => request<{ members: ServerMemberView[] }>(`/servers/${id}/members`).then((value) => value.members),
  addServerMember: (id: string, userId: string, role: Exclude<MemberRole, "owner"> = "member") => request(`/servers/${id}/members`, { method: "POST", body: { userId, role, roleIds: [] } }),
  updateServerMember: (id: string, userId: string, patch: { role?: Exclude<MemberRole, "owner">; roleIds?: string[] }) => request(`/servers/${id}/members/${userId}`, { method: "PATCH", body: patch }),
  kickServerMember: (id: string, userId: string) => request(`/servers/${id}/members/${userId}`, { method: "DELETE" }),
  serverBans: (id: string) => request<{ bans: ServerBan[] }>(`/servers/${id}/bans`).then((value) => value.bans),
  banServerMember: (id: string, userId: string, reason = "") => request(`/servers/${id}/bans/${userId}`, { method: "POST", body: { reason } }),
  unbanServerMember: (id: string, userId: string) => request(`/servers/${id}/bans/${userId}`, { method: "DELETE" }),
  serverRoles: (id: string) => request<{ roles: ServerRoleDefinition[] }>(`/servers/${id}/roles`).then((value) => value.roles),
  createServerRole: (id: string, input: { name: string; color: string | null; permissions: ServerPermission[] }) => request<{ role: ServerRoleDefinition }>(`/servers/${id}/roles`, { method: "POST", body: input }).then((value) => value.role),
  updateServerRole: (id: string, roleId: string, patch: Partial<Pick<ServerRoleDefinition, "name" | "color" | "permissions" | "position">>) => request<{ role: ServerRoleDefinition }>(`/servers/${id}/roles/${roleId}`, { method: "PATCH", body: patch }).then((value) => value.role),
  deleteServerRole: (id: string, roleId: string) => request(`/servers/${id}/roles/${roleId}`, { method: "DELETE" }),
  createCategory: (id: string, name: string) => request<{ category: ChannelCategory }>(`/servers/${id}/categories`, { method: "POST", body: { name } }).then((value) => value.category),
  updateCategory: (id: string, categoryId: string, patch: { name?: string; position?: number }) => request<{ category: ChannelCategory }>(`/servers/${id}/categories/${categoryId}`, { method: "PATCH", body: patch }).then((value) => value.category),
  deleteCategory: (id: string, categoryId: string) => request(`/servers/${id}/categories/${categoryId}`, { method: "DELETE" }),
  createChannel: (id: string, input: { name: string; kind: "text" | "voice"; categoryId: string | null; topic: string }) => request<{ channel: ChannelSummary }>(`/servers/${id}/channels`, { method: "POST", body: input }).then((value) => value.channel),
  updateChannel: (id: string, channelId: string, patch: { name?: string; topic?: string; categoryId?: string | null; position?: number }) => request<{ channel: ChannelSummary }>(`/servers/${id}/channels/${channelId}`, { method: "PATCH", body: patch }).then((value) => value.channel),
  deleteChannel: (id: string, channelId: string) => request(`/servers/${id}/channels/${channelId}`, { method: "DELETE" }),
  channelOverrides: (id: string, channelId: string) => request<{ items: ChannelPermissionOverride[] }>(`/servers/${id}/channels/${channelId}/overrides`).then((value) => value.items),
  setChannelOverride: (id: string, channelId: string, targetType: ChannelPermissionOverride["targetType"], targetId: string, body: Pick<ChannelPermissionOverride, "allow" | "deny">) => request<{ item: ChannelPermissionOverride }>(`/servers/${id}/channels/${channelId}/overrides/${targetType === "everyone" ? "everyone" : `${targetType}s/${targetId}`}`, { method: "PUT", body }).then((value) => value.item),
  removeChannelOverride: (id: string, channelId: string, targetType: ChannelPermissionOverride["targetType"], targetId: string) => request(`/servers/${id}/channels/${channelId}/overrides/${targetType === "everyone" ? "everyone" : `${targetType}s/${targetId}`}`, { method: "DELETE" }),
  auditLog: (id: string, before?: string) => request<{ items: ServerAuditEntry[]; nextCursor: string | null }>(`/servers/${id}/audit-log?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`),

  mentions: (before?: string) => request<{ items: Message[]; nextCursor: string | null }>(`/mentions?limit=30${before ? `&before=${encodeURIComponent(before)}` : ""}`),
  serverNotificationPolicies: () => request<{ items: ServerNotificationPolicy[] }>("/notifications/servers").then((value) => value.items),
  setServerNotificationPolicy: (id: string, policy: NotificationPolicy) => request<{ item: ServerNotificationPolicy }>(`/notifications/servers/${id}`, { method: "PUT", body: policy }).then((value) => value.item),
  clearServerNotificationPolicy: (id: string) => request(`/notifications/servers/${id}`, { method: "DELETE" }),
  streamNotificationPolicies: () => request<{ items: StreamNotificationPolicy[] }>("/notifications/streams").then((value) => value.items),
  setStreamNotificationPolicy: (id: string, streamKind: "conversation" | "channel", policy: NotificationPolicy) => request<{ item: StreamNotificationPolicy }>(`/notifications/streams/${id}`, { method: "PUT", body: { streamKind, ...policy } }).then((value) => value.item),
  clearStreamNotificationPolicy: (id: string) => request(`/notifications/streams/${id}`, { method: "DELETE" }),
};
