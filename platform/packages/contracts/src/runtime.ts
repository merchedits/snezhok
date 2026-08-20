import { z } from "zod";

import { cooperativeActivityTypeValues, idSchema, serverPermissionSchema } from "./schemas.js";

export const timestampSchema = z.number().finite().nonnegative();
const nullableTimestampSchema = timestampSchema.nullable();
const relativeOrAbsoluteUrlSchema = z.string().min(1).max(4096);
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const userSummarySchema = z.object({
  id: idSchema,
  username: z.string().min(1).max(64),
  displayName: z.string().max(128),
  avatarUrl: relativeOrAbsoluteUrlSchema.nullable(),
  avatarColor: z.string().min(1).max(64),
  bio: z.string().max(4096),
  statusText: z.string().max(512),
  presence: z.enum(["online", "idle", "do-not-disturb", "offline"]),
  lastSeenAt: timestampSchema,
  isAdmin: z.boolean().optional(),
});

export const attachmentSchema = z.object({
  id: idSchema,
  ownerId: idSchema,
  kind: z.enum(["image", "video", "audio", "document"]),
  filename: z.string().min(1).max(1024),
  mimeType: z.string().min(1).max(255),
  bytes: z.number().finite().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().finite().nonnegative().nullable(),
  quality: z.enum(["data-saver", "auto", "high", "original"]),
  url: relativeOrAbsoluteUrlSchema,
  originalUrl: relativeOrAbsoluteUrlSchema.optional(),
  thumbnailUrl: relativeOrAbsoluteUrlSchema.nullable(),
  checksum: z.string().min(1).max(256),
  primaryChecksum: z.string().min(1).max(256).optional(),
  waveform: z.array(z.number().finite()).max(4096).nullable().optional(),
  status: z.enum(["processing", "ready", "failed"]).optional(),
  updatedAt: timestampSchema.optional(),
});

export const attachmentLifecycleUpdateSchema = z.object({
  id: idSchema,
  status: z.enum(["processing", "ready", "failed"]),
  updatedAt: timestampSchema,
  attachment: attachmentSchema.nullable(),
});

export const messagePreviewSchema = z.object({
  id: idSchema,
  senderId: idSchema,
  senderName: z.string().max(128),
  text: z.string().max(16_000),
  kind: z.enum(["text", "system", "voice", "video-note", "media", "file"]),
  createdAt: timestampSchema,
});

export const reactionSummarySchema = z.object({
  emoji: z.string().min(1).max(32),
  count: z.number().int().nonnegative(),
  reacted: z.boolean(),
  userIds: z.array(idSchema).max(10_000),
});

export const cooperativeActivityParticipantSchema = z.object({
  user: userSummarySchema,
  status: z.enum(["invited", "active", "submitted", "completed", "declined"]),
  contributionCount: z.number().int().nonnegative(),
  submittedAt: nullableTimestampSchema,
});

export const cooperativeActivityEntrySchema = z.object({
  id: idSchema,
  kind: z.string().min(1).max(128),
  round: z.number().int().nonnegative(),
  createdBy: idSchema,
  payload: jsonObjectSchema,
  attachments: z.array(attachmentSchema).max(100),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const cooperativeActivitySchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  anchorMessageId: idSchema,
  type: z.enum(cooperativeActivityTypeValues),
  state: z.enum(["active", "waiting", "locked", "completed", "declined", "expired", "cancelled"]),
  revision: z.number().int().nonnegative(),
  createdBy: idSchema,
  config: jsonObjectSchema,
  privateState: jsonObjectSchema,
  result: jsonObjectSchema.nullable(),
  participants: z.array(cooperativeActivityParticipantSchema).min(1).max(100),
  entries: z.array(cooperativeActivityEntrySchema).max(2_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  revealAt: nullableTimestampSchema,
  completedAt: nullableTimestampSchema,
  detail: z.enum(["summary", "full"]).optional(),
});

export const messageSchema = z.object({
  id: idSchema,
  revision: z.number().int().positive().optional(),
  clientId: idSchema.nullable().optional(),
  streamId: idSchema,
  streamKind: z.enum(["conversation", "channel"]),
  sequence: z.number().int().nonnegative(),
  sender: userSummarySchema,
  kind: z.enum(["text", "system", "voice", "video-note", "media", "file"]),
  text: z.string().max(16_000),
  replyTo: messagePreviewSchema.nullable(),
  forwardedFrom: messagePreviewSchema.nullable().optional(),
  attachments: z.array(attachmentSchema).max(10),
  reactions: z.array(reactionSummarySchema).max(100),
  activity: cooperativeActivitySchema.nullable().optional(),
  createdAt: timestampSchema,
  editedAt: nullableTimestampSchema,
  deletedAt: nullableTimestampSchema,
  pinnedAt: nullableTimestampSchema,
  silent: z.boolean().optional(),
  readByOthers: z.boolean().optional(),
  pending: z.boolean().optional(),
  failed: z.boolean().optional(),
});

export const conversationSummarySchema = z.object({
  id: idSchema,
  kind: z.enum(["direct", "group"]),
  title: z.string().max(128),
  avatarUrl: relativeOrAbsoluteUrlSchema.nullable(),
  participants: z.array(userSummarySchema).max(100),
  lastMessage: messagePreviewSchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
  mentionCount: z.number().int().nonnegative(),
  muted: z.boolean(),
  pinned: z.boolean(),
  archived: z.boolean(),
  saved: z.boolean(),
  updatedAt: timestampSchema,
});

export const serverSummarySchema = z.object({
  id: idSchema,
  name: z.string().max(128),
  iconUrl: relativeOrAbsoluteUrlSchema.nullable(),
  ownerId: idSchema,
  unread: z.boolean(),
  mentionCount: z.number().int().nonnegative(),
  position: z.number().int().nonnegative(),
});

export const channelCategorySchema = z.object({
  id: idSchema,
  serverId: idSchema,
  name: z.string().max(128),
  position: z.number().int().nonnegative(),
  collapsed: z.boolean(),
});

export const channelSummarySchema = z.object({
  id: idSchema,
  serverId: idSchema,
  categoryId: idSchema.nullable(),
  kind: z.enum(["text", "voice"]),
  name: z.string().max(128),
  topic: z.string().max(4096),
  position: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  mentionCount: z.number().int().nonnegative(),
  connectedMembers: z.array(userSummarySchema).max(1_000),
});

export const friendEntrySchema = z.object({
  user: userSummarySchema,
  relationship: z.enum(["friend", "incoming", "outgoing", "blocked"]),
  requestId: idSchema.optional(),
});

export const sessionDeviceSchema = z.object({
  id: idSchema,
  label: z.string().max(256),
  platform: z.enum(["web", "android"]),
  ipAddress: z.string().max(128),
  lastUsedAt: timestampSchema,
  current: z.boolean(),
  userAgent: z.string().max(2048).optional(),
  createdAt: timestampSchema.optional(),
  expiresAt: timestampSchema.optional(),
});

export const privacySettingsOutputSchema = z.object({
  directMessages: z.enum(["everyone", "contacts", "nobody"]),
  groupInvites: z.enum(["everyone", "contacts", "nobody"]),
  profilePhotos: z.enum(["everyone", "contacts", "nobody"]),
});

export const serverRoleDefinitionSchema = z.object({
  id: idSchema,
  serverId: idSchema,
  name: z.string().max(128),
  color: z.string().max(64).nullable(),
  position: z.number().int().nonnegative(),
  permissions: z.array(serverPermissionSchema).max(32),
});

export const channelPermissionOverrideOutputSchema = z.object({
  channelId: idSchema,
  targetType: z.enum(["everyone", "role", "member"]),
  targetId: idSchema,
  allow: z.array(serverPermissionSchema).max(32),
  deny: z.array(serverPermissionSchema).max(32),
});

export const notificationPolicySchema = z.object({
  enabled: z.boolean().nullable(),
  showPreview: z.boolean().nullable(),
  sound: z.boolean().nullable(),
  mobile: z.boolean().nullable(),
  mentionsOnly: z.boolean().nullable(),
  mutedUntil: nullableTimestampSchema,
});

export const streamNotificationPolicySchema = notificationPolicySchema.extend({
  streamKind: z.enum(["conversation", "channel"]),
  streamId: idSchema,
});

export const serverNotificationPolicySchema = notificationPolicySchema.extend({ serverId: idSchema });

export const serverAuditEntrySchema = z.object({
  id: idSchema,
  serverId: idSchema,
  actorId: idSchema.nullable(),
  action: z.string().min(1).max(128),
  targetUserId: idSchema.nullable(),
  targetEntityId: idSchema.nullable(),
  metadata: jsonObjectSchema,
  createdAt: timestampSchema,
});

export const successEnvelopeSchema = z.object({ success: z.literal(true) });
export const conversationEnvelopeSchema = z.object({ conversation: conversationSummarySchema });
export const serverEnvelopeSchema = z.object({ server: serverSummarySchema });
export const categoryEnvelopeSchema = z.object({ category: channelCategorySchema });
export const channelEnvelopeSchema = z.object({ channel: channelSummarySchema });
export const serverRoleEnvelopeSchema = z.object({ role: serverRoleDefinitionSchema });
export const channelOverrideEnvelopeSchema = z.object({ item: channelPermissionOverrideOutputSchema });
export const sessionsEnvelopeSchema = z.object({ sessions: z.array(sessionDeviceSchema).max(1_000) });
export const revokeSessionEnvelopeSchema = z.object({ success: z.literal(true), current: z.boolean() });
export const revokedSessionsEnvelopeSchema = z.object({ revoked: z.number().int().nonnegative() });
export const privacyEnvelopeSchema = z.object({ privacy: privacySettingsOutputSchema });
export const groupMemberOutputSchema = z.object({
  user: userSummarySchema,
  role: z.enum(["owner", "admin", "member"]),
  joinedAt: timestampSchema,
});
export const groupMembersEnvelopeSchema = z.object({ members: z.array(groupMemberOutputSchema).max(100) });
export const serverAuthorizationSchema = z.object({
  role: z.enum(["owner", "admin", "moderator", "member"]),
  permissions: z.array(serverPermissionSchema).max(32),
  rank: z.number().int(),
});
export const serverDetailsSchema = z.object({ server: serverSummarySchema, authorization: serverAuthorizationSchema });
export const serverMemberViewSchema = z.object({
  user: userSummarySchema,
  role: z.enum(["owner", "admin", "moderator", "member"]),
  roleIds: z.array(idSchema).max(1_000),
  joinedAt: timestampSchema,
});
export const serverMembersEnvelopeSchema = z.object({ members: z.array(serverMemberViewSchema).max(100_000) });
export const serverBanOutputSchema = z.object({
  user: userSummarySchema,
  reason: z.string().max(4_096),
  bannedBy: idSchema.nullable(),
  createdAt: timestampSchema,
});
export const serverBansEnvelopeSchema = z.object({ bans: z.array(serverBanOutputSchema).max(100_000) });
export const serverRolesEnvelopeSchema = z.object({ roles: z.array(serverRoleDefinitionSchema).max(1_000) });
export const channelOverridesEnvelopeSchema = z.object({ items: z.array(channelPermissionOverrideOutputSchema).max(100_000) });
export const auditLogEnvelopeSchema = z.object({ items: z.array(serverAuditEntrySchema).max(1_000), nextCursor: z.string().max(256).nullable() });
export const mentionsEnvelopeSchema = z.object({ items: z.array(messageSchema).max(100), nextCursor: z.string().max(256).nullable() });
export const serverNotificationPoliciesEnvelopeSchema = z.object({ items: z.array(serverNotificationPolicySchema).max(10_000) });
export const serverNotificationPolicyEnvelopeSchema = z.object({ item: serverNotificationPolicySchema });
export const streamNotificationPoliciesEnvelopeSchema = z.object({ items: z.array(streamNotificationPolicySchema).max(10_000) });
export const streamNotificationPolicyEnvelopeSchema = z.object({ item: streamNotificationPolicySchema });
export const emptyResponseSchema = z.undefined();
export const mutationAcknowledgementSchema = z.union([successEnvelopeSchema, emptyResponseSchema]);

export const profilePhotoOutputSchema = z.object({
  id: idSchema,
  url: relativeOrAbsoluteUrlSchema,
  thumbnailUrl: relativeOrAbsoluteUrlSchema.nullable(),
  position: z.number().int().nonnegative(),
  createdAt: timestampSchema,
});
export const userProfileSchema = z.object({ user: userSummarySchema, photos: z.array(profilePhotoOutputSchema).max(100) });
export const usersEnvelopeSchema = z.object({ users: z.array(userSummarySchema).max(100) });
export const userEnvelopeSchema = z.object({ user: userSummarySchema });
export const profileEnvelopeSchema = z.object({ profile: userProfileSchema });
export const hiddenMessageEnvelopeSchema = z.object({ hidden: z.object({ id: idSchema, streamId: idSchema }) });
export const registeredPushEnvelopeSchema = z.object({ registered: z.literal(true) });
export const acceptedDiagnosticEnvelopeSchema = z.object({ accepted: z.literal(true), requestId: z.string().min(1).max(256) });
export const diagnosticHealthSchema = z.object({
  status: z.literal("ok"),
  requestId: z.string().min(1).max(256),
  databaseLatencyMs: z.number().finite().nonnegative(),
  databasePool: z.object({ total: z.number().int().nonnegative(), idle: z.number().int().nonnegative(), waiting: z.number().int().nonnegative() }),
  process: z.object({ uptimeSeconds: z.number().int().nonnegative(), rssBytes: z.number().int().nonnegative(), heapUsedBytes: z.number().int().nonnegative() }),
  clientDiagnostics: z.object({ problems24h: z.number().int().nonnegative() }),
  checkedAt: timestampSchema,
});
export type DiagnosticHealth = z.infer<typeof diagnosticHealthSchema>;

export const chatDraftSchema = z.object({
  streamKind: z.enum(["conversation", "channel"]), streamId: idSchema, text: z.string().max(16_000),
  replyToId: idSchema.nullable(), updatedAt: timestampSchema,
});
export const chatFolderSchema = z.object({
  id: idSchema, name: z.string().min(1).max(40), position: z.number().int().nonnegative(), includeArchived: z.boolean(),
  streams: z.array(z.object({ streamKind: z.enum(["conversation", "channel"]), streamId: idSchema })).max(200),
});
export const scheduledMessageSchema = z.object({
  id: idSchema, streamKind: z.enum(["conversation", "channel"]), streamId: idSchema,
  text: z.string().max(16_000), kind: z.string().min(1).max(64), silent: z.boolean(), scheduledFor: timestampSchema,
});
export const productivityPayloadSchema = z.object({
  drafts: z.array(chatDraftSchema).max(10_000), folders: z.array(chatFolderSchema).max(1_000), scheduled: z.array(scheduledMessageSchema).max(10_000),
});
export const draftEnvelopeSchema = z.object({ draft: chatDraftSchema.nullable() });
export const scheduledEnvelopeSchema = z.object({ scheduled: scheduledMessageSchema });
export const folderEnvelopeSchema = z.object({ folder: chatFolderSchema });
export const friendEnvelopeSchema = z.object({ entry: friendEntrySchema });
export const searchEnvelopeSchema = z.object({
  users: z.array(userSummarySchema).max(100),
  messages: z.array(messageSchema).max(100),
  files: z.array(z.object({ id: idSchema, filename: z.string().max(1_024), kind: z.string().max(64), bytes: z.number().finite().nonnegative(), url: relativeOrAbsoluteUrlSchema })).max(100),
});

export const adminSettingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  defaultPermissions: z.object({ createServers: z.boolean(), createGroups: z.boolean(), uploadFiles: z.boolean(), startCalls: z.boolean() }),
  defaultStorageQuotaBytes: z.number().finite().nonnegative(), maxUploadBytes: z.number().finite().positive(),
  messageRetentionDays: z.number().int().positive().nullable(), orphanMediaRetentionDays: z.number().int().nonnegative(),
  eventRetentionDays: z.number().int().positive(), updatedAt: timestampSchema,
  featureCapabilities: z.object({ uploads: z.boolean(), calls: z.boolean(), activities: z.boolean(), servers: z.boolean() }),
});
export const adminMemberSchema = z.object({
  id: idSchema, username: z.string().min(1).max(64), displayName: z.string().max(128), isAdmin: z.boolean(), suspended: z.boolean(),
  createdAt: timestampSchema,
  permissionOverrides: z.object({ createServers: z.boolean().optional(), createGroups: z.boolean().optional(), uploadFiles: z.boolean().optional(), startCalls: z.boolean().optional() }),
  storageQuotaBytes: z.number().finite().nonnegative().nullable(), storageUsedBytes: z.number().finite().nonnegative(),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;
export type AdminMember = z.infer<typeof adminMemberSchema>;
export type GlobalPermissions = AdminSettings["defaultPermissions"];
export type GlobalPermission = keyof GlobalPermissions;
export const adminSettingsEnvelopeSchema = z.object({ settings: adminSettingsSchema });
export const adminMemberEnvelopeSchema = z.object({ member: adminMemberSchema });
export const adminMembersEnvelopeSchema = z.object({ items: z.array(adminMemberSchema).max(10_000), nextCursor: z.string().max(256).nullable() });

export const appSettingsSchema = z.object({
  theme: z.enum(["system", "light", "dark"]),
  accent: z.enum(["blue", "green", "purple", "orange", "red"]),
  fontScale: z.number().finite(),
  density: z.enum(["compact", "comfortable"]),
  bubbleRadius: z.number().finite(),
  reducedMotion: z.boolean(),
  highContrast: z.boolean(),
  language: z.enum(["en", "ru"]),
  readReceipts: z.boolean(),
  showLastSeen: z.boolean(),
  stripMediaLocation: z.boolean(),
  defaultUploadQuality: z.enum(["data-saver", "auto", "high", "original"]),
  autoDownloadWifi: z.boolean(),
  autoDownloadMobile: z.boolean(),
  noiseSuppression: z.enum(["off", "standard", "high"]),
  echoCancellation: z.boolean(),
  autoGainControl: z.boolean(),
  microphoneMode: z.enum(["system", "phone", "speakerphone"]),
  callAudioRoute: z.enum(["auto", "earpiece", "speaker", "headset", "bluetooth"]),
  callQuality: z.enum(["data-saver", "auto", "high"]),
  screenShareQuality: z.enum(["data-saver", "auto", "high"]),
  pushToTalk: z.boolean(),
  cooperativeMatureContent: z.boolean(),
  messageNotifications: z.boolean().optional(),
  callNotifications: z.boolean().optional(),
  notificationPreviews: z.boolean().optional(),
  notificationSound: z.boolean().optional(),
  notificationMobile: z.boolean().optional(),
  notificationMentionsOnly: z.boolean().optional(),
  quietHoursStart: z.number().int().min(0).max(1439).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(1439).nullable().optional(),
  quietHoursTimezoneOffsetMinutes: z.number().int().optional(),
  quietHoursDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

export const settingsEnvelopeSchema = z.object({ settings: appSettingsSchema });

export const runtimeCapabilitiesSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  sourceRevision: z.string().min(1).max(64),
  uploads: z.boolean(), calls: z.boolean(), activities: z.boolean(), servers: z.boolean(),
  maxUploadBytes: z.number().int().positive(),
});

export const bootstrapPayloadSchema = z.object({
  me: userSummarySchema.extend({ isAdmin: z.boolean() }),
  conversations: z.array(conversationSummarySchema).max(10_000),
  servers: z.array(serverSummarySchema).max(1_000),
  categories: z.array(channelCategorySchema).max(10_000),
  channels: z.array(channelSummarySchema).max(10_000),
  friends: z.array(friendEntrySchema).max(10_000),
  settings: appSettingsSchema,
  eventCursor: z.number().int().nonnegative(),
  capabilities: runtimeCapabilitiesSchema.optional(),
});

export const authResponseSchema = z.object({
  accessToken: z.string().min(1).max(16_384),
  refreshToken: z.string().min(1).max(16_384),
  expiresIn: z.number().int().positive(),
  user: userSummarySchema,
});

export const messageEnvelopeSchema = z.object({ message: messageSchema });
export const messagesEnvelopeSchema = z.object({ messages: z.array(messageSchema).max(1_000) });
export const activityEnvelopeSchema = z.object({ activity: cooperativeActivitySchema });
export const activityHistoryEnvelopeSchema = z.object({ messages: z.array(messageSchema).max(1_000) });
export const messagePageSchema = z.object({
  items: z.array(messageSchema).max(100),
  nextCursor: z.string().max(256).nullable(),
});
export const messageContextSchema = z.object({
  streamId: idSchema,
  targetId: idSchema,
  items: z.array(messageSchema).max(100),
});
export const readCursorSchema = z.object({
  streamId: idSchema,
  userId: idSchema,
  sequence: z.number().int().nonnegative(),
  markedUnread: z.boolean().optional(),
});

export const uploadResponseSchema = z.object({ attachment: attachmentSchema });
export const uploadInitResponseSchema = z.object({
  uploadId: idSchema,
  upload: z.object({
    id: idSchema,
    offset: z.number().int().nonnegative(),
    chunkBytes: z.number().int().positive(),
    expiresAt: timestampSchema,
    capability: z.string().min(16).max(1024),
  }),
});
export const backgroundMessageGroupInitResponseSchema = z.object({
  dispatchStatus: z.enum(["waiting", "pending", "delivered"]),
  sessions: z.array(z.object({
    uploadId: idSchema,
    status: z.enum(["uploading", "complete"]),
    attachment: attachmentSchema.nullable(),
    expiresAt: timestampSchema.nullable(),
    upload: uploadInitResponseSchema.shape.upload.nullable(),
  })).max(10),
});

export const callJoinResponseSchema = z.object({
  callId: idSchema,
  url: relativeOrAbsoluteUrlSchema,
  token: z.string().min(1).max(32_768),
  roomName: z.string().min(1).max(255),
  canEnd: z.boolean(),
});

export const androidReleaseManifestSchema = z.object({
  applicationId: z.literal("xyz.merchedits.snezhok"),
  version: z.string().min(1).max(64),
  versionCode: z.number().int().positive(),
  minimumVersionCode: z.number().int().positive(),
  mandatory: z.boolean(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  signingCertificateSha256: z.string().regex(/^[a-f0-9]{64}$/),
  publishedAt: z.string().min(1).max(128),
  releaseNotes: z.array(z.string().max(1_000)).max(100),
  downloadUrl: relativeOrAbsoluteUrlSchema,
  downloadMirrors: z.array(relativeOrAbsoluteUrlSchema).max(10).optional(),
});
