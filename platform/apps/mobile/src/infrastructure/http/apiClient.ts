import * as Crypto from "expo-crypto";

import {
  activityEnvelopeSchema,
  acceptedDiagnosticEnvelopeSchema,
  adminMemberEnvelopeSchema,
  adminMembersEnvelopeSchema,
  adminSettingsEnvelopeSchema,
  androidReleaseManifestSchema,
  authResponseSchema,
  backgroundMessageGroupInitResponseSchema,
  bootstrapPayloadSchema,
  callJoinResponseSchema,
  conversationEnvelopeSchema,
  diagnosticHealthSchema,
  draftEnvelopeSchema,
  folderEnvelopeSchema,
  friendEnvelopeSchema,
  hiddenMessageEnvelopeSchema,
  mutationAcknowledgementSchema,
  productivityPayloadSchema,
  profileEnvelopeSchema,
  readCursorSchema,
  registeredPushEnvelopeSchema,
  scheduledEnvelopeSchema,
  searchEnvelopeSchema,
  serverEnvelopeSchema,
  settingsEnvelopeSchema,
  successEnvelopeSchema,
  userEnvelopeSchema,
  usersEnvelopeSchema,
} from "@snezhok/contracts";
import type { AdminMember, AdminSettings, AppSettings, Attachment, BootstrapPayload, ConversationSummary, CooperativeActivity, CooperativeActivityType, DiagnosticHealth, FriendEntry, GlobalPermission, Message, ServerSummary, UserProfile, UserSummary } from "@snezhok/contracts";

import type {
  AuthResponse,
  AndroidReleaseManifest,
  BackgroundMessageGroupInitResponse,
  CallJoinResponse,
  ChatFolder,
  MessageCreateInput,
  MessagesResponse,
  ProductivityPayload,
  ScheduledMessage,
  UploadInput,
  UploadInitResponse,
  UploadProgressCallback,
} from "../../types";
import type { DiagnosticReport } from "../../diagnostics/diagnostics";
import { ResumableUploadClient } from "../uploads/resumableUploadClient";
import { closeRemoteDeviceSession } from "../../lib/sessionClosure";
import { getRuntimeSession } from "../../lib/secureSession";
import { API_URL } from "./apiConfig";
import { fetchWithTimeout, sessionTransport, type JsonRequestOptions, type ResponseDecoder } from "./sessionTransport";
import {
  resilientMessageContextDecoder,
  resilientMessageEnvelopeDecoder,
  resilientMessagePageDecoder,
  resilientMessagesEnvelopeDecoder,
} from "./messageResponseDecoders";

export { ApiError } from "../../lib/apiError";

type RequestOptions = JsonRequestOptions;

export type { AdminMember, AdminSettings, DiagnosticHealth, GlobalPermission, GlobalPermissions } from "@snezhok/contracts";

export { API_URL } from "./apiConfig";

class ApiClient {
  private readonly uploadClient = new ResumableUploadClient((path, options, decoder) => this.request(path, options, decoder));

  private request<T>(path: string, options: RequestOptions, decoder: ResponseDecoder): Promise<T> {
    return sessionTransport.request<T>(path, options, decoder);
  }

  login(username: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>("/auth/login", {
      method: "POST",
      authenticated: false,
      body: { username, password, deviceName: "Snezhok for Android", platform: "android" },
    }, authResponseSchema);
  }

  register(input: { email: string; username: string; password: string }): Promise<AuthResponse> {
    return this.request<AuthResponse>("/auth/register", {
      method: "POST",
      authenticated: false,
      body: { ...input, deviceName: "Snezhok for Android", platform: "android" },
    }, authResponseSchema);
  }

  bootstrap(): Promise<BootstrapPayload> {
    return this.request<BootstrapPayload>("/bootstrap", {}, bootstrapPayloadSchema);
  }

  adminSettings(): Promise<AdminSettings> {
    return this.request<{ settings: AdminSettings }>("/admin/settings", {}, adminSettingsEnvelopeSchema).then((result) => result.settings);
  }

  updateAdminSettings(input: { revision: number } & Partial<Omit<AdminSettings, "revision" | "updatedAt">>): Promise<AdminSettings> {
    return this.request<{ settings: AdminSettings }>("/admin/settings", { method: "PATCH", body: input }, adminSettingsEnvelopeSchema).then((result) => result.settings);
  }

  adminMembers(query = "", cursor?: string): Promise<{ items: AdminMember[]; nextCursor: string | null }> {
    const params = new URLSearchParams({ limit: "50", q: query });
    if (cursor) params.set("cursor", cursor);
    return this.request(`/admin/members?${params}`, {}, adminMembersEnvelopeSchema);
  }

  updateAdminMember(userId: string, input: { isAdmin?: boolean; suspended?: boolean; permissionOverrides?: Partial<Record<GlobalPermission, boolean | null>>; storageQuotaBytes?: number | null }): Promise<AdminMember> {
    return this.request<{ member: AdminMember }>(`/admin/members/${encodeURIComponent(userId)}`, { method: "PATCH", body: input }, adminMemberEnvelopeSchema).then((result) => result.member);
  }

  androidRelease(): Promise<AndroidReleaseManifest> {
    return this.request<AndroidReleaseManifest>("/client/android/manifest", { authenticated: false }, androidReleaseManifestSchema);
  }

  messages(streamId: string, before?: number): Promise<MessagesResponse> {
    const query = new URLSearchParams({ limit: "60" });
    if (before !== undefined) query.set("before", String(before));
    return this.request<MessagesResponse>(`/streams/${encodeURIComponent(streamId)}/messages?${query}`, {}, resilientMessagePageDecoder);
  }

  markRead(streamId: string, sequence: number): Promise<{ streamId: string; userId: string; sequence: number }> {
    return this.request(`/streams/${encodeURIComponent(streamId)}/read`, {
      method: "POST",
      body: { sequence },
    }, readCursorSchema);
  }

  markUnread(streamId: string, sequence?: number): Promise<{ streamId: string; userId: string; sequence: number; markedUnread: true }> {
    return this.request(`/streams/${encodeURIComponent(streamId)}/unread`, {
      method: "POST",
      ...(sequence === undefined ? {} : { body: { sequence } }),
    }, readCursorSchema) as Promise<{ streamId: string; userId: string; sequence: number; markedUnread: true }>;
  }

  pinnedMessages(streamId: string): Promise<Message[]> {
    return this.request<{ messages: Message[] }>(`/streams/${encodeURIComponent(streamId)}/pins`, {}, resilientMessagesEnvelopeDecoder).then((result) => result.messages);
  }

  messageContext(messageId: string): Promise<{ streamId: string; targetId: string; items: Message[] }> {
    return this.request<{ streamId: string; targetId: string; items: Message[] }>(`/messages/${encodeURIComponent(messageId)}/context?limit=60`, {}, resilientMessageContextDecoder);
  }

  createMessage(streamId: string, input: MessageCreateInput): Promise<Message> {
    return this.request<{ message: Message }>(`/streams/${encodeURIComponent(streamId)}/messages`, {
      method: "POST",
      body: input,
    }, resilientMessageEnvelopeDecoder).then((result) => result.message);
  }

  createActivity(conversationId: string, type: CooperativeActivityType, options: Record<string, unknown> = {}, clientId = Crypto.randomUUID()): Promise<Message> {
    return this.request<{ message: Message }>(`/conversations/${encodeURIComponent(conversationId)}/activities`, {
      method: "POST",
      body: { clientId, type, options },
    }, resilientMessageEnvelopeDecoder).then((result) => result.message);
  }

  activity(activityId: string): Promise<CooperativeActivity> {
    return this.request<{ activity: CooperativeActivity }>(`/activities/${encodeURIComponent(activityId)}`, {}, activityEnvelopeSchema).then((result) => result.activity);
  }

  activityHistory(conversationId: string): Promise<Message[]> {
    return this.request<{ messages: Message[] }>(`/conversations/${encodeURIComponent(conversationId)}/activities/history`, {}, resilientMessagesEnvelopeDecoder).then((result) => result.messages);
  }

  commandActivity(activityId: string, expectedRevision: number, action: string, payload: Record<string, unknown> = {}, clientId = Crypto.randomUUID()): Promise<Message> {
    return this.request<{ message: Message }>(`/activities/${encodeURIComponent(activityId)}/commands`, {
      method: "POST",
      body: { clientId, expectedRevision, action, payload },
    }, resilientMessageEnvelopeDecoder).then((result) => result.message);
  }

  forwardMessage(messageId: string, targetStreamId: string, clientId: string): Promise<Message> {
    return this.request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}/forward`, {
      method: "POST",
      body: { targetStreamId, clientId },
    }, resilientMessageEnvelopeDecoder).then((result) => result.message);
  }

  editMessage(messageId: string, text: string): Promise<Message> {
    return this.request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: { text },
    }, resilientMessageEnvelopeDecoder).then((result) => result.message);
  }

  setReaction(messageId: string, emoji: string, active: boolean): Promise<Message> {
    return this.request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: "PUT",
      body: { emoji, active },
    }, resilientMessageEnvelopeDecoder).then((result) => result.message);
  }

  deleteMessage(messageId: string): Promise<Message> {
    return this.request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}?scope=everyone`, {
      method: "DELETE",
    }, resilientMessageEnvelopeDecoder).then((result) => result.message);
  }

  hideMessage(messageId: string): Promise<{ id: string; streamId: string }> {
    return this.request<{ hidden: { id: string; streamId: string } }>(`/messages/${encodeURIComponent(messageId)}?scope=me`, {
      method: "DELETE",
    }, hiddenMessageEnvelopeSchema).then((result) => result.hidden);
  }

  setMessagePinned(messageId: string, pinned: boolean): Promise<Message> {
    return this.request<{ message: Message }>(`/messages/${encodeURIComponent(messageId)}/pin`, {
      method: "PUT",
      body: { pinned },
    }, resilientMessageEnvelopeDecoder).then((result) => result.message);
  }

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.request<{ settings: AppSettings }>("/settings", { method: "PATCH", body: patch }, settingsEnvelopeSchema).then((result) => result.settings);
  }

  async initializeBackgroundUpload(input: UploadInput): Promise<{ initialized: UploadInitResponse; bytes: number }> {
    return this.uploadClient.initialize(input);
  }

  initializeBackgroundMessageGroup(input: {
    streamId: string;
    clientId: string;
    kind: "media" | "file" | "voice" | "video-note";
    replyToId: string | null;
    silent: boolean;
    capabilityUploadIds: string[];
    uploads: Array<{ uploadId: string; input: UploadInput; bytes: number }>;
  }): Promise<BackgroundMessageGroupInitResponse> {
    return this.request<BackgroundMessageGroupInitResponse>("/uploads/message-group", {
      method: "POST",
      body: {
        streamId: input.streamId,
        clientId: input.clientId,
        kind: input.kind,
        replyToId: input.replyToId,
        silent: input.silent,
        capabilityUploadIds: input.capabilityUploadIds,
        uploads: input.uploads.map(({ uploadId, input: upload, bytes }) => ({
          uploadId,
          filename: upload.filename,
          mimeType: upload.mimeType,
          bytes,
          quality: upload.quality,
          kind: upload.kind,
          stripLocation: upload.stripLocation ?? true,
          purpose: upload.purpose ?? "standard",
        })),
      },
    }, backgroundMessageGroupInitResponseSchema);
  }

  cancelInitializedUpload(uploadId: string): Promise<void> {
    return this.uploadClient.cancelInitialized(uploadId);
  }

  async upload(input: UploadInput, onProgress?: UploadProgressCallback, transferId?: string): Promise<Attachment> {
    return this.uploadClient.upload(input, onProgress, transferId);
  }

  async cancelUpload(transferId?: string): Promise<void> {
    return this.uploadClient.cancel(transferId);
  }

  joinCall(streamId: string, expectedCallId?: string): Promise<CallJoinResponse> {
    return this.request<CallJoinResponse>("/calls/token", { method: "POST", body: { streamId, ...(expectedCallId ? { expectedCallId } : {}) } }, callJoinResponseSchema);
  }

  endCall(callId: string): Promise<void> {
    return this.request(`/calls/${encodeURIComponent(callId)}/end`, { method: "POST" }, mutationAcknowledgementSchema).then(() => undefined);
  }

  leaveCall(callId: string): Promise<void> {
    return this.request(`/calls/${encodeURIComponent(callId)}/leave`, { method: "POST" }, mutationAcknowledgementSchema).then(() => undefined);
  }

  declineCall(callId: string): Promise<void> {
    return this.request(`/calls/${encodeURIComponent(callId)}/decline`, { method: "POST" }, mutationAcknowledgementSchema).then(() => undefined);
  }

  registerPushDevice(token: string, installationId: string, appVersion: string): Promise<{ registered: true }> {
    return this.request("/notifications/devices", { method: "POST", body: { token, installationId, appVersion, platform: "android" } }, registeredPushEnvelopeSchema);
  }

  unregisterPushDevice(installationId: string): Promise<void> {
    return this.request(`/notifications/devices/${encodeURIComponent(installationId)}`, { method: "DELETE" }, mutationAcknowledgementSchema);
  }

  /**
   * Closes the current device remotely with a captured access token. It does
   * not read or mutate local session state, so callers can clear the device
   * immediately while this best-effort cleanup continues in the background.
   */
  async closeDeviceSession(accessToken: string, installationId?: string | null): Promise<void> {
    await closeRemoteDeviceSession(API_URL, accessToken, installationId, (url, init) => fetchWithTimeout(url, init));
  }

  diagnosticHealth(): Promise<DiagnosticHealth> {
    return this.request<DiagnosticHealth>("/diagnostics/health", {}, diagnosticHealthSchema);
  }

  sendDiagnosticReport(report: DiagnosticReport): Promise<{ accepted: true; requestId: string }> {
    return this.request("/diagnostics/client-reports", { method: "POST", body: report }, acceptedDiagnosticEnvelopeSchema);
  }

  searchUsers(query: string): Promise<UserSummary[]> {
    return this.request<{ users: UserSummary[] }>(`/users/search?q=${encodeURIComponent(query)}`, {}, usersEnvelopeSchema).then((result) => result.users);
  }

  profile(userId: string): Promise<UserProfile> {
    return this.request<{ profile: UserProfile }>(`/users/${encodeURIComponent(userId)}/profile`, {}, profileEnvelopeSchema).then((result) => result.profile);
  }

  updateProfile(input: { displayName?: string; bio?: string; statusText?: string }): Promise<UserSummary> {
    return this.request<{ user: UserSummary }>("/users/me", { method: "PATCH", body: input }, userEnvelopeSchema).then((result) => result.user);
  }

  addProfilePhoto(attachmentId: string): Promise<UserProfile> {
    return this.request<{ profile: UserProfile }>("/users/me/profile-photos", { method: "POST", body: { attachmentId } }, profileEnvelopeSchema).then((result) => result.profile);
  }

  reorderProfilePhotos(attachmentIds: string[]): Promise<UserProfile> {
    return this.request<{ profile: UserProfile }>("/users/me/profile-photos/order", { method: "PATCH", body: { attachmentIds } }, profileEnvelopeSchema).then((result) => result.profile);
  }

  removeProfilePhoto(attachmentId: string): Promise<UserProfile> {
    return this.request<{ profile: UserProfile }>(`/users/me/profile-photos/${encodeURIComponent(attachmentId)}`, { method: "DELETE" }, profileEnvelopeSchema).then((result) => result.profile);
  }

  createConversation(participantIds: string[], title?: string): Promise<ConversationSummary> {
    return this.request<{ conversation: ConversationSummary }>("/conversations", {
      method: "POST",
      body: title ? { participantIds, title } : { participantIds },
    }, conversationEnvelopeSchema).then((result) => result.conversation);
  }

  deleteConversation(conversationId: string): Promise<void> {
    return this.request(`/conversations/${encodeURIComponent(conversationId)}/members/me`, { method: "DELETE" }, successEnvelopeSchema).then(() => undefined);
  }

  updateConversationPreferences(conversationId: string, patch: { pinned?: boolean; archived?: boolean; muted?: boolean }): Promise<ConversationSummary> {
    return this.request<{ conversation: ConversationSummary }>(`/conversations/${encodeURIComponent(conversationId)}/preferences`, { method: "PATCH", body: patch }, conversationEnvelopeSchema)
      .then((result) => result.conversation);
  }

  search(query: string, streamId?: string, scope: "all" | "messages" | "media" | "files" | "links" = "all"): Promise<{ users: UserSummary[]; messages: Message[]; files: Array<{ id: string; filename: string; kind: string; bytes: number; url: string }> }> {
    const params = new URLSearchParams({ q: query, scope, limit: "50" });
    if (streamId) params.set("streamId", streamId);
    return this.request(`/search?${params}`, {}, searchEnvelopeSchema);
  }

  productivity(): Promise<ProductivityPayload> {
    return this.request("/productivity", {}, productivityPayloadSchema);
  }

  saveDraft(streamId: string, text: string, replyToId: string | null): Promise<void> {
    return this.request(`/streams/${encodeURIComponent(streamId)}/draft`, { method: "PUT", body: { text, replyToId } }, draftEnvelopeSchema).then(() => undefined);
  }

  scheduleMessage(streamId: string, input: MessageCreateInput, scheduledFor: number): Promise<ScheduledMessage> {
    return this.request<{ scheduled: ScheduledMessage }>(`/streams/${encodeURIComponent(streamId)}/scheduled`, {
      method: "POST",
      body: { ...input, scheduledFor },
    }, scheduledEnvelopeSchema).then((result) => result.scheduled);
  }

  createFolder(name: string, streams: ChatFolder["streams"] = []): Promise<ChatFolder> {
    return this.request<{ folder: ChatFolder }>("/folders", { method: "POST", body: { name, includeArchived: false, streams } }, folderEnvelopeSchema).then((result) => result.folder);
  }

  updateFolder(folderId: string, patch: Partial<Pick<ChatFolder, "name" | "includeArchived" | "streams">>): Promise<ChatFolder> {
    return this.request<{ folder: ChatFolder }>(`/folders/${encodeURIComponent(folderId)}`, { method: "PATCH", body: patch }, folderEnvelopeSchema).then((result) => result.folder);
  }

  deleteFolder(folderId: string): Promise<void> {
    return this.request(`/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" }, successEnvelopeSchema).then(() => undefined);
  }

  cancelScheduledMessage(scheduledMessageId: string): Promise<void> {
    return this.request(`/scheduled/${encodeURIComponent(scheduledMessageId)}`, { method: "DELETE" }, successEnvelopeSchema).then(() => undefined);
  }

  createServer(name: string): Promise<ServerSummary> {
    return this.request<{ server: ServerSummary }>("/servers", { method: "POST", body: { name } }, serverEnvelopeSchema).then((result) => result.server);
  }

  requestFriend(username: string): Promise<FriendEntry> {
    return this.request<{ entry: FriendEntry }>("/friends/requests", { method: "POST", body: { username } }, friendEnvelopeSchema).then((result) => result.entry);
  }

  respondFriend(requestId: string, action: "accept" | "decline"): Promise<FriendEntry> {
    return this.request<{ entry: FriendEntry }>(`/friends/requests/${encodeURIComponent(requestId)}/respond`, { method: "POST", body: { action } }, friendEnvelopeSchema).then((result) => result.entry);
  }

  cancelFriendRequest(requestId: string): Promise<void> {
    return this.request(`/friends/requests/${encodeURIComponent(requestId)}`, { method: "DELETE" }, successEnvelopeSchema).then(() => undefined);
  }

  removeFriend(userId: string): Promise<void> {
    return this.request(`/friends/${encodeURIComponent(userId)}`, { method: "DELETE" }, successEnvelopeSchema).then(() => undefined);
  }

  blockUser(userId: string): Promise<void> {
    return this.request(`/friends/${encodeURIComponent(userId)}/block`, { method: "POST" }, successEnvelopeSchema).then(() => undefined);
  }
}

export const api = new ApiClient();

export function resolveApiResource(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const apiRoot = API_URL.replace(/\/api\/v1$/, "");
  return path.startsWith("/api/v1/") ? `${apiRoot}${path}` : `${API_URL}/${path.replace(/^\//, "")}`;
}
