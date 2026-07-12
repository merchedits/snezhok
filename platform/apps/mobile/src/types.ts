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
  };
  Call: { streamId: string; title: string };
};

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
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
  };
}

export interface UploadInput {
  uri: string;
  filename: string;
  mimeType: string;
  kind: Attachment["kind"];
  quality: UploadQuality;
}

export interface MessageCreateInput {
  clientId: string;
  text: string;
  kind: Exclude<MessageKind, "system">;
  replyToId: string | null;
  attachmentIds: string[];
}

export interface CachedState {
  bootstrap: BootstrapPayload | null;
  messages: Record<string, Message[]>;
  cachedAt: number;
}

export interface OutboxEntry {
  id: string;
  streamId: string;
  input: MessageCreateInput;
  queuedAt: number;
  attempts: number;
}

export interface MessagesResponse extends CursorPage<Message> {}

export type SettingsPatch = Partial<AppSettings>;
