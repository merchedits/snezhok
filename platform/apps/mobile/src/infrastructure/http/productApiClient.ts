import {
  auditLogEnvelopeSchema,
  categoryEnvelopeSchema,
  channelEnvelopeSchema,
  channelOverrideEnvelopeSchema,
  channelOverridesEnvelopeSchema,
  conversationEnvelopeSchema,
  groupMembersEnvelopeSchema,
  mentionsEnvelopeSchema,
  mutationAcknowledgementSchema,
  privacyEnvelopeSchema,
  revokeSessionEnvelopeSchema,
  revokedSessionsEnvelopeSchema,
  serverBansEnvelopeSchema,
  serverDetailsSchema,
  serverEnvelopeSchema,
  serverMembersEnvelopeSchema,
  serverNotificationPoliciesEnvelopeSchema,
  serverNotificationPolicyEnvelopeSchema,
  serverRoleEnvelopeSchema,
  serverRolesEnvelopeSchema,
  sessionsEnvelopeSchema,
  streamNotificationPoliciesEnvelopeSchema,
  streamNotificationPolicyEnvelopeSchema,
  successEnvelopeSchema,
} from "@snezhok/contracts";
import type {
  ChannelCategory, ChannelPermissionOverride, ChannelSummary, ConversationSummary, MemberRole,
  Message, NotificationPolicy, PrivacySettings, ServerAuditEntry,
  ServerNotificationPolicy, ServerPermission, ServerRoleDefinition, ServerSummary,
  SessionDevice, StreamNotificationPolicy, UserSummary,
} from "@snezhok/contracts";

import { clearSession } from "../../lib/secureSession";
import { sessionTransport, type ResponseDecoder } from "./sessionTransport";

type GroupRole = "owner" | "admin" | "member";
export interface GroupMember { user: UserSummary; role: GroupRole; joinedAt: number }
export interface ServerBan { user: UserSummary; reason: string; bannedBy: string | null; createdAt: number }
export interface ServerMemberView { user: UserSummary; role: MemberRole; roleIds: string[]; joinedAt: number }
export interface ServerAuthorizationView { role: MemberRole; permissions: ServerPermission[]; rank: number }
export interface ServerDetails { server: ServerSummary; authorization: ServerAuthorizationView }

type JsonOptions = Omit<RequestInit, "body"> & { body?: BodyInit | object };

function request<T>(path: string, options: JsonOptions = {}, decoder: ResponseDecoder): Promise<T> {
  return sessionTransport.request<T>(path, options, decoder);
}

export const productApi = {
  sessions: () => request<{ sessions: SessionDevice[] }>("/auth/sessions", {}, sessionsEnvelopeSchema).then((value) => value.sessions),
  revokeSession: (id: string) => request<{ success: true; current: boolean }>(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }, revokeSessionEnvelopeSchema),
  revokeOtherSessions: () => request<{ revoked: number }>("/auth/sessions/revoke-others", { method: "POST" }, revokedSessionsEnvelopeSchema),
  deleteAccount: async (password: string) => { await request("/users/me", { method: "DELETE", body: { password, confirmation: "DELETE" } }, successEnvelopeSchema); await clearSession(); },

  privacy: () => request<{ privacy: PrivacySettings }>("/users/me/privacy", {}, privacyEnvelopeSchema).then((value) => value.privacy),
  updatePrivacy: (patch: Partial<PrivacySettings>) => request<{ privacy: PrivacySettings }>("/users/me/privacy", { method: "PATCH", body: patch }, privacyEnvelopeSchema).then((value) => value.privacy),
  blockUser: (id: string) => request(`/friends/${encodeURIComponent(id)}/block`, { method: "POST" }, successEnvelopeSchema),
  unblockUser: (id: string) => request(`/friends/${encodeURIComponent(id)}/block`, { method: "DELETE" }, successEnvelopeSchema),

  createGroup: (participantIds: string[], title: string) => request<{ conversation: ConversationSummary }>("/conversations", { method: "POST", body: { participantIds, title } }, conversationEnvelopeSchema).then((value) => value.conversation),
  updateGroup: (id: string, patch: { title?: string; avatarAttachmentId?: string | null }) => request<{ conversation: ConversationSummary }>(`/conversations/${id}`, { method: "PATCH", body: patch }, conversationEnvelopeSchema).then((value) => value.conversation),
  groupMembers: (id: string) => request<{ members: GroupMember[] }>(`/conversations/${id}/members`, {}, groupMembersEnvelopeSchema).then((value) => value.members),
  addGroupMember: (id: string, userId: string, role: "admin" | "member" = "member") => request(`/conversations/${id}/members`, { method: "POST", body: { userId, role } }, conversationEnvelopeSchema),
  setGroupMemberRole: (id: string, userId: string, role: "admin" | "member") => request(`/conversations/${id}/members/${userId}`, { method: "PATCH", body: { role } }, successEnvelopeSchema),
  removeGroupMember: (id: string, userId: string) => request(`/conversations/${id}/members/${userId}`, { method: "DELETE" }, successEnvelopeSchema),
  transferGroup: (id: string, userId: string) => request(`/conversations/${id}/ownership`, { method: "POST", body: { userId } }, successEnvelopeSchema),
  leaveGroup: (id: string) => request(`/conversations/${id}/members/me`, { method: "DELETE" }, successEnvelopeSchema),

  server: (id: string) => request<ServerDetails>(`/servers/${id}`, {}, serverDetailsSchema),
  updateServer: (id: string, patch: { name?: string; iconAttachmentId?: string | null }) => request<{ server: ServerSummary }>(`/servers/${id}`, { method: "PATCH", body: patch }, serverEnvelopeSchema).then((value) => value.server),
  deleteServer: (id: string) => request(`/servers/${id}`, { method: "DELETE" }, successEnvelopeSchema),
  transferServer: (id: string, userId: string) => request(`/servers/${id}/ownership`, { method: "POST", body: { userId } }, successEnvelopeSchema),
  leaveServer: (id: string, userId: string) => request(`/servers/${id}/members/${userId}`, { method: "DELETE" }, successEnvelopeSchema),
  serverMembers: (id: string) => request<{ members: ServerMemberView[] }>(`/servers/${id}/members`, {}, serverMembersEnvelopeSchema).then((value) => value.members),
  addServerMember: (id: string, userId: string, role: Exclude<MemberRole, "owner"> = "member") => request(`/servers/${id}/members`, { method: "POST", body: { userId, role, roleIds: [] } }, successEnvelopeSchema),
  updateServerMember: (id: string, userId: string, patch: { role?: Exclude<MemberRole, "owner">; roleIds?: string[] }) => request(`/servers/${id}/members/${userId}`, { method: "PATCH", body: patch }, successEnvelopeSchema),
  kickServerMember: (id: string, userId: string) => request(`/servers/${id}/members/${userId}`, { method: "DELETE" }, successEnvelopeSchema),
  serverBans: (id: string) => request<{ bans: ServerBan[] }>(`/servers/${id}/bans`, {}, serverBansEnvelopeSchema).then((value) => value.bans),
  banServerMember: (id: string, userId: string, reason = "") => request(`/servers/${id}/bans/${userId}`, { method: "POST", body: { reason } }, successEnvelopeSchema),
  unbanServerMember: (id: string, userId: string) => request(`/servers/${id}/bans/${userId}`, { method: "DELETE" }, successEnvelopeSchema),
  serverRoles: (id: string) => request<{ roles: ServerRoleDefinition[] }>(`/servers/${id}/roles`, {}, serverRolesEnvelopeSchema).then((value) => value.roles),
  createServerRole: (id: string, input: { name: string; color: string | null; permissions: ServerPermission[] }) => request<{ role: ServerRoleDefinition }>(`/servers/${id}/roles`, { method: "POST", body: input }, serverRoleEnvelopeSchema).then((value) => value.role),
  updateServerRole: (id: string, roleId: string, patch: Partial<Pick<ServerRoleDefinition, "name" | "color" | "permissions" | "position">>) => request<{ role: ServerRoleDefinition }>(`/servers/${id}/roles/${roleId}`, { method: "PATCH", body: patch }, serverRoleEnvelopeSchema).then((value) => value.role),
  deleteServerRole: (id: string, roleId: string) => request(`/servers/${id}/roles/${roleId}`, { method: "DELETE" }, successEnvelopeSchema),
  createCategory: (id: string, name: string) => request<{ category: ChannelCategory }>(`/servers/${id}/categories`, { method: "POST", body: { name } }, categoryEnvelopeSchema).then((value) => value.category),
  updateCategory: (id: string, categoryId: string, patch: { name?: string; position?: number }) => request<{ category: ChannelCategory }>(`/servers/${id}/categories/${categoryId}`, { method: "PATCH", body: patch }, categoryEnvelopeSchema).then((value) => value.category),
  deleteCategory: (id: string, categoryId: string) => request(`/servers/${id}/categories/${categoryId}`, { method: "DELETE" }, successEnvelopeSchema),
  createChannel: (id: string, input: { name: string; kind: "text" | "voice"; categoryId: string | null; topic: string }) => request<{ channel: ChannelSummary }>(`/servers/${id}/channels`, { method: "POST", body: input }, channelEnvelopeSchema).then((value) => value.channel),
  updateChannel: (id: string, channelId: string, patch: { name?: string; topic?: string; categoryId?: string | null; position?: number }) => request<{ channel: ChannelSummary }>(`/servers/${id}/channels/${channelId}`, { method: "PATCH", body: patch }, channelEnvelopeSchema).then((value) => value.channel),
  deleteChannel: (id: string, channelId: string) => request(`/servers/${id}/channels/${channelId}`, { method: "DELETE" }, successEnvelopeSchema),
  channelOverrides: (id: string, channelId: string) => request<{ items: ChannelPermissionOverride[] }>(`/servers/${id}/channels/${channelId}/overrides`, {}, channelOverridesEnvelopeSchema).then((value) => value.items),
  setChannelOverride: (id: string, channelId: string, targetType: ChannelPermissionOverride["targetType"], targetId: string, body: Pick<ChannelPermissionOverride, "allow" | "deny">) => request<{ item: ChannelPermissionOverride }>(`/servers/${id}/channels/${channelId}/overrides/${targetType === "everyone" ? "everyone" : `${targetType}s/${targetId}`}`, { method: "PUT", body }, channelOverrideEnvelopeSchema).then((value) => value.item),
  removeChannelOverride: (id: string, channelId: string, targetType: ChannelPermissionOverride["targetType"], targetId: string) => request(`/servers/${id}/channels/${channelId}/overrides/${targetType === "everyone" ? "everyone" : `${targetType}s/${targetId}`}`, { method: "DELETE" }, mutationAcknowledgementSchema),
  auditLog: (id: string, before?: string) => request<{ items: ServerAuditEntry[]; nextCursor: string | null }>(`/servers/${id}/audit-log?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`, {}, auditLogEnvelopeSchema),

  mentions: (before?: string) => request<{ items: Message[]; nextCursor: string | null }>(`/mentions?limit=30${before ? `&before=${encodeURIComponent(before)}` : ""}`, {}, mentionsEnvelopeSchema),
  serverNotificationPolicies: () => request<{ items: ServerNotificationPolicy[] }>("/notifications/servers", {}, serverNotificationPoliciesEnvelopeSchema).then((value) => value.items),
  setServerNotificationPolicy: (id: string, policy: NotificationPolicy) => request<{ item: ServerNotificationPolicy }>(`/notifications/servers/${id}`, { method: "PUT", body: policy }, serverNotificationPolicyEnvelopeSchema).then((value) => value.item),
  clearServerNotificationPolicy: (id: string) => request(`/notifications/servers/${id}`, { method: "DELETE" }, mutationAcknowledgementSchema),
  streamNotificationPolicies: () => request<{ items: StreamNotificationPolicy[] }>("/notifications/streams", {}, streamNotificationPoliciesEnvelopeSchema).then((value) => value.items),
  setStreamNotificationPolicy: (id: string, streamKind: "conversation" | "channel", policy: NotificationPolicy) => request<{ item: StreamNotificationPolicy }>(`/notifications/streams/${id}`, { method: "PUT", body: { streamKind, ...policy } }, streamNotificationPolicyEnvelopeSchema).then((value) => value.item),
  clearStreamNotificationPolicy: (id: string) => request(`/notifications/streams/${id}`, { method: "DELETE" }, mutationAcknowledgementSchema),
};
