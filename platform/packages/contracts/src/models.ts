export type Id = string;
export type Timestamp = number;

export type Presence = "online" | "idle" | "do-not-disturb" | "offline";
export type Theme = "system" | "light" | "dark";
export type UploadQuality = "data-saver" | "auto" | "high" | "original";
export type ChannelKind = "text" | "voice";
export type ConversationKind = "direct" | "group";
export type MessageKind = "text" | "system" | "voice" | "video-note" | "media" | "file";
export type MemberRole = "owner" | "admin" | "moderator" | "member";
export type PrivacyAudience = "everyone" | "contacts" | "nobody";
export type ServerPermission =
  | "view_channels" | "send_messages" | "attach_files" | "add_reactions"
  | "manage_messages" | "connect" | "speak" | "video" | "screen_share"
  | "move_members" | "manage_channels" | "manage_categories" | "manage_members"
  | "kick_members" | "ban_members" | "manage_roles" | "manage_server"
  | "view_audit_log";

export interface UserSummary {
  id: Id;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColor: string;
  bio: string;
  statusText: string;
  presence: Presence;
  lastSeenAt: Timestamp;
  /** Present only for the authenticated account. Never exposed on public profiles. */
  isAdmin?: boolean;
}

export interface ProfilePhoto {
  id: Id;
  url: string;
  thumbnailUrl: string | null;
  position: number;
  createdAt: Timestamp;
}

export interface UserProfile {
  user: UserSummary;
  photos: ProfilePhoto[];
}

export interface SessionDevice {
  id: Id;
  label: string;
  platform: "web" | "android";
  ipAddress: string;
  lastUsedAt: Timestamp;
  current: boolean;
  userAgent?: string;
  createdAt?: Timestamp;
  expiresAt?: Timestamp;
}

export interface PrivacySettings {
  directMessages: PrivacyAudience;
  groupInvites: PrivacyAudience;
  profilePhotos: PrivacyAudience;
}

export interface ServerRoleDefinition {
  id: Id;
  serverId: Id;
  name: string;
  color: string | null;
  position: number;
  permissions: ServerPermission[];
}

export interface ChannelPermissionOverride {
  channelId: Id;
  targetType: "everyone" | "role" | "member";
  targetId: Id;
  allow: ServerPermission[];
  deny: ServerPermission[];
}

export interface NotificationPolicy {
  enabled: boolean | null;
  showPreview: boolean | null;
  sound: boolean | null;
  mobile: boolean | null;
  mentionsOnly: boolean | null;
  mutedUntil: Timestamp | null;
}

export interface StreamNotificationPolicy extends NotificationPolicy {
  streamKind: "conversation" | "channel";
  streamId: Id;
}

export interface ServerNotificationPolicy extends NotificationPolicy {
  serverId: Id;
}

export interface ServerMember {
  user: UserSummary;
  role: MemberRole;
  roles: ServerRoleDefinition[];
  joinedAt: Timestamp;
}

export interface ServerAuditEntry {
  id: string;
  serverId: Id;
  actorId: Id | null;
  action: string;
  targetUserId: Id | null;
  targetEntityId: Id | null;
  metadata: Record<string, unknown>;
  createdAt: Timestamp;
}

export interface FriendEntry {
  user: UserSummary;
  relationship: "friend" | "incoming" | "outgoing" | "blocked";
  requestId?: Id;
}

export interface ConversationSummary {
  id: Id;
  kind: ConversationKind;
  title: string;
  avatarUrl: string | null;
  participants: UserSummary[];
  lastMessage: MessagePreview | null;
  unreadCount: number;
  mentionCount: number;
  muted: boolean;
  pinned: boolean;
  archived: boolean;
  /** True only for the private, single-member conversation owned by this user. */
  saved: boolean;
  updatedAt: Timestamp;
}

export interface ServerSummary {
  id: Id;
  name: string;
  iconUrl: string | null;
  ownerId: Id;
  unread: boolean;
  mentionCount: number;
  position: number;
}

export interface ChannelCategory {
  id: Id;
  serverId: Id;
  name: string;
  position: number;
  collapsed: boolean;
}

export interface ChannelSummary {
  id: Id;
  serverId: Id;
  categoryId: Id | null;
  kind: ChannelKind;
  name: string;
  topic: string;
  position: number;
  unreadCount: number;
  mentionCount: number;
  connectedMembers: UserSummary[];
}

export interface MessagePreview {
  id: Id;
  senderId: Id;
  senderName: string;
  text: string;
  kind: MessageKind;
  createdAt: Timestamp;
}

export interface Attachment {
  id: Id;
  ownerId: Id;
  kind: "image" | "video" | "audio" | "document";
  filename: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  quality: UploadQuality;
  url: string;
  /** Immutable source upload; omitted by older servers. */
  originalUrl?: string;
  thumbnailUrl: string | null;
  checksum: string;
  /** Optimized derivative checksum; the top-level checksum remains the original for compatibility. */
  primaryChecksum?: string;
  /** Audio envelope; null while the media worker is still processing. */
  waveform?: number[] | null;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  reacted: boolean;
  userIds: Id[];
}

export interface Message {
  id: Id;
  /** Stable sender-generated identifier used to reconcile optimistic messages. */
  clientId?: Id | null;
  streamId: Id;
  streamKind: "conversation" | "channel";
  sequence: number;
  sender: UserSummary;
  kind: MessageKind;
  text: string;
  replyTo: MessagePreview | null;
  forwardedFrom?: MessagePreview | null;
  attachments: Attachment[];
  reactions: ReactionSummary[];
  createdAt: Timestamp;
  editedAt: Timestamp | null;
  deletedAt: Timestamp | null;
  pinnedAt: Timestamp | null;
  /** Delivered normally but without producing a recipient notification. */
  silent?: boolean;
  /** True when at least one other visible recipient has advanced past this message. */
  readByOthers?: boolean;
  pending?: boolean;
  failed?: boolean;
}

export interface AppSettings {
  theme: Theme;
  accent: "blue" | "green" | "purple" | "orange" | "red";
  fontScale: number;
  density: "compact" | "comfortable";
  bubbleRadius: number;
  reducedMotion: boolean;
  highContrast: boolean;
  language: "en" | "ru";
  readReceipts: boolean;
  showLastSeen: boolean;
  stripMediaLocation: boolean;
  defaultUploadQuality: UploadQuality;
  autoDownloadWifi: boolean;
  autoDownloadMobile: boolean;
  noiseSuppression: "off" | "standard" | "high";
  echoCancellation: boolean;
  autoGainControl: boolean;
  microphoneMode: "system" | "phone" | "speakerphone";
  callAudioRoute: "auto" | "earpiece" | "speaker" | "headset" | "bluetooth";
  callQuality: "data-saver" | "auto" | "high";
  screenShareQuality: "data-saver" | "auto" | "high";
  pushToTalk: boolean;
  /** Global push controls; optional for backward compatibility with older cached settings. */
  messageNotifications?: boolean;
  callNotifications?: boolean;
  notificationPreviews?: boolean;
  notificationSound?: boolean;
  notificationMobile?: boolean;
  notificationMentionsOnly?: boolean;
  /** Local minutes after midnight. Both values are null when quiet hours are disabled. */
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  quietHoursTimezoneOffsetMinutes?: number;
  /** Local weekdays using JavaScript's 0=Sunday through 6=Saturday convention. */
  quietHoursDays?: number[];
}

export interface BootstrapPayload {
  me: UserSummary & { isAdmin: boolean };
  conversations: ConversationSummary[];
  servers: ServerSummary[];
  categories: ChannelCategory[];
  channels: ChannelSummary[];
  friends: FriendEntry[];
  settings: AppSettings;
  eventCursor: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}
