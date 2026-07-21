import type {
  AppSettings,
  Attachment,
  BootstrapPayload,
  CursorPage,
  Message,
  MessageKind,
  UploadQuality,
  UserSummary,
} from "@snezhok/contracts";

export type RootStackParamList = {
  Main: undefined;
  Contacts: undefined;
  Settings: undefined;
  Chat: {
    streamId: string;
    streamKind: "conversation" | "channel";
    title: string;
    subtitle?: string;
    targetMessageId?: string;
    openedAt?: number;
  };
  Call: { streamId: string; title: string; startWithVideo?: boolean };
  Profile: { userId: string };
  Diagnostics: undefined;
};

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** Stable cache/outbox ownership. Older sessions derive it from JWT `sub`. */
  ownerId?: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserSummary;
}

export interface CallJoinResponse {
  callId: string;
  url: string;
  token: string;
  roomName: string;
  canEnd: boolean;
}

export interface AndroidReleaseManifest {
  applicationId: "xyz.merchedits.snezhok";
  version: string;
  versionCode: number;
  minimumVersionCode: number;
  mandatory: boolean;
  bytes: number;
  sha256: string;
  signingCertificateSha256: string;
  publishedAt: string;
  releaseNotes: string[];
  downloadUrl: string;
}

export interface UploadResponse {
  attachment: Attachment;
}

export interface UploadInitResponse {
  uploadId: string;
  upload: {
    id: string;
    offset: number;
    chunkBytes: number;
    expiresAt: number;
    capability: string;
  };
}

export interface BackgroundMessageGroupInitResponse {
  dispatchStatus: "waiting" | "pending" | "delivered";
  sessions: Array<{
    uploadId: string;
    status: "uploading" | "complete";
    attachment: Attachment | null;
    expiresAt: number | null;
    upload: UploadInitResponse["upload"] | null;
  }>;
}

export interface UploadInput {
  uri: string;
  filename: string;
  mimeType: string;
  kind: Attachment["kind"];
  quality: UploadQuality;
  purpose?: "standard" | "voice" | "video-note";
  stripLocation?: boolean;
  /** User-initiated uploads allow mobile data unless a future picker opts out. */
  allowMetered?: boolean;
}

export type UploadProgressCallback = (progress: number) => void;

export interface MessageCreateInput {
  clientId: string;
  text: string;
  kind: Exclude<MessageKind, "system">;
  replyToId: string | null;
  attachmentIds: string[];
  silent: boolean;
}

export interface CachedState {
  bootstrap: BootstrapPayload | null;
  messages: Record<string, Message[]>;
  cachedAt: number;
}

interface OutboxBase {
  id: string;
  streamId: string;
  queuedAt: number;
  attempts: number;
}

/** `kind` is optional so cached v1 message entries remain valid after upgrade. */
export interface OutboxMessageEntry extends OutboxBase {
  kind: "message";
  input: MessageCreateInput;
}

export interface OutboxForwardEntry extends OutboxBase {
  kind: "forward";
  sourceMessageId: string;
  clientId: string;
}

export interface OutboxReadEntry extends OutboxBase {
  kind: "read";
  sequence: number;
}

export interface OutboxEditEntry extends OutboxBase {
  kind: "edit";
  messageId: string;
  text: string;
  previous: Message;
}

export interface OutboxDeleteEntry extends OutboxBase {
  kind: "delete";
  messageId: string;
  scope: "me" | "everyone";
  previous: Message;
}

export interface OutboxPinEntry extends OutboxBase {
  kind: "pin";
  messageId: string;
  pinned: boolean;
  previous: Message;
}

export interface OutboxReactionEntry extends OutboxBase {
  kind: "reaction";
  messageId: string;
  emoji: string;
  active: boolean;
  previous: Message;
}

export type OutboxEntry = OutboxMessageEntry | OutboxForwardEntry | OutboxReadEntry | OutboxEditEntry | OutboxDeleteEntry | OutboxPinEntry | OutboxReactionEntry;

export interface MessagesResponse extends CursorPage<Message> {}

export interface ChatDraft {
  streamKind: "conversation" | "channel";
  streamId: string;
  text: string;
  replyToId: string | null;
  updatedAt: number;
}

export interface ChatFolder {
  id: string;
  name: string;
  position: number;
  includeArchived: boolean;
  streams: Array<{ streamKind: "conversation" | "channel"; streamId: string }>;
}

export interface ScheduledMessage {
  id: string;
  streamKind: "conversation" | "channel";
  streamId: string;
  text: string;
  kind: string;
  silent: boolean;
  scheduledFor: number;
}

export interface ProductivityPayload {
  drafts: ChatDraft[];
  folders: ChatFolder[];
  scheduled: ScheduledMessage[];
}

export type SettingsPatch = Partial<AppSettings>;
