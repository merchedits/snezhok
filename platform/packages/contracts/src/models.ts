export type Id = string;
export type Timestamp = number;

export type Presence = "online" | "idle" | "do-not-disturb" | "offline";
export type Theme = "system" | "light" | "dark";
export type UploadQuality = "data-saver" | "auto" | "high" | "original";
export type ChannelKind = "text" | "voice";
export type ConversationKind = "direct" | "group";
export type MessageKind = "text" | "system" | "voice" | "video-note" | "media" | "file";
export type MemberRole = "owner" | "admin" | "moderator" | "member";

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
  waveform?: number[];
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
  pushToTalk: boolean;
}

export interface BootstrapPayload {
  me: UserSummary;
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
