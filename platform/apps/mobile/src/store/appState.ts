import type {
  AppSettings,
  Attachment,
  AttachmentLifecycleUpdate,
  BootstrapPayload,
  ChannelCategory,
  ChannelSummary,
  ConversationSummary,
  CooperativeActivityType,
  FriendEntry,
  Message,
  Presence,
  RuntimeCapabilities,
  ServerSummary,
  UserSummary,
} from "@snezhok/contracts";

import type { AttachmentRepositoryState } from "../repositories/attachments/attachmentRepository";
import type { MessageRepositoryState } from "../repositories/messages/messageRepository";
import { productCapabilities } from "../config/productCapabilities";
import type { AttachmentMessageKind } from "../transfers/backgroundTransferModel";
import type { ChatFolder, MessageCreateInput, OutboxEntry, ScheduledMessage, SettingsPatch, UploadInput } from "../types";

export type AppPhase = "booting" | "signed-out" | "ready" | "error";

export interface AppState {
  phase: AppPhase;
  error: string | null;
  online: boolean;
  syncing: boolean;
  eventCursor: number;
  me: UserSummary | null;
  conversations: ConversationSummary[];
  servers: ServerSummary[];
  categories: ChannelCategory[];
  channels: ChannelSummary[];
  friends: FriendEntry[];
  settings: AppSettings;
  capabilities: RuntimeCapabilities;
  messages: Record<string, Message[]>;
  attachmentRepository: AttachmentRepositoryState;
  messageRepository: MessageRepositoryState;
  messagePagination: Record<string, { nextCursor: number | null; initialized: boolean }>;
  drafts: Record<string, string>;
  folders: ChatFolder[];
  scheduledMessages: ScheduledMessage[];
  outbox: OutboxEntry[];
  initialize: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (input: { email: string; username: string; password: string }) => Promise<void>;
  clearError: () => void;
  signOut: () => Promise<void>;
  setOnline: (online: boolean) => void;
  refreshBootstrap: (options?: { force?: boolean; silent?: boolean }) => Promise<void>;
  refreshProductivity: () => Promise<void>;
  loadMessages: (streamId: string, before?: number) => Promise<void>;
  preloadCachedMessages: (streamIds: readonly string[]) => Promise<void>;
  loadOlderMessages: (streamId: string) => Promise<void>;
  loadMessageContext: (streamId: string, messageId: string) => Promise<void>;
  markStreamRead: (streamId: string, sequence: number) => Promise<void>;
  markStreamUnread: (streamId: string, sequence?: number) => Promise<void>;
  loadPinnedMessages: (streamId: string) => Promise<void>;
  uploadAttachment: (input: UploadInput, onProgress?: (progress: number) => void, transferId?: string) => Promise<Attachment>;
  sendAttachmentBatch: (streamId: string, inputs: UploadInput[], messageKind: AttachmentMessageKind, replyToId: string | null, text?: string) => AttachmentTransferTask;
  reconcileBackgroundTransfers: () => Promise<void>;
  retryAttachmentTransfer: (clientId: string) => Promise<void>;
  cancelUpload: (transferId?: string) => Promise<void>;
  sendMessage: (streamId: string, input: Omit<MessageCreateInput, "clientId" | "silent"> & { silent?: boolean }, optimisticAttachments?: Attachment[]) => Promise<void>;
  forwardMessage: (messageId: string, targetStreamId: string) => Promise<Message>;
  editMessage: (message: Message, text: string) => Promise<void>;
  toggleReaction: (message: Message, emoji: string) => Promise<void>;
  deleteMessage: (message: Message, scope: "me" | "everyone") => Promise<void>;
  deleteMessages: (messages: Message[], scope: "me" | "everyone") => Promise<void>;
  setMessagePinned: (message: Message, pinned: boolean) => Promise<void>;
  createActivity: (conversationId: string, type: CooperativeActivityType, options?: Record<string, unknown>) => Promise<Message>;
  commandActivity: (message: Message, action: string, payload?: Record<string, unknown>) => Promise<Message>;
  retryOutbox: () => Promise<void>;
  applyMessage: (message: Message, eventKind?: "created" | "updated") => void;
  applyAttachmentLifecycle: (update: AttachmentLifecycleUpdate) => void;
  applyMessageDeleted: (payload: { id: string; streamId: string; deletedAt: number }) => void;
  applyReadReceipt: (payload: { streamId: string; userId: string; sequence: number }) => void;
  applyConversation: (conversation: ConversationSummary) => void;
  deleteConversation: (conversationId: string) => Promise<void>;
  removeConversation: (conversationId: string) => void;
  applyPresence: (userId: string, presence: Presence, lastSeenAt: number) => void;
  setDraft: (streamId: string, text: string) => void;
  scheduleTextMessage: (streamId: string, input: Omit<MessageCreateInput, "clientId">, scheduledFor: number) => Promise<void>;
  cancelScheduledMessage: (scheduledMessageId: string) => Promise<void>;
  createFolder: (name: string, streams?: ChatFolder["streams"]) => Promise<void>;
  setFolderMembership: (folder: ChatFolder, stream: ChatFolder["streams"][number], included: boolean) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  setConversationPreference: (conversation: ConversationSummary, patch: { pinned?: boolean; archived?: boolean; muted?: boolean }) => Promise<void>;
  updateSettings: (patch: SettingsPatch) => Promise<void>;
  setEventCursor: (cursor: number) => void;
}

export interface AttachmentTransferTask {
  id: string;
  /** Resolves after the transfer intent is durable and safe to dismiss. */
  accepted: Promise<void>;
  completion: Promise<void>;
}

export type AppStorePatch = AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>);
export type AppStoreSet = (update: AppStorePatch) => void;
export type AppStoreGet = () => AppState;

export const defaultSettings: AppSettings = {
  theme: "system",
  accent: "blue",
  fontScale: 1,
  density: "comfortable",
  bubbleRadius: 16,
  reducedMotion: false,
  highContrast: false,
  language: "ru",
  readReceipts: true,
  showLastSeen: true,
  stripMediaLocation: true,
  defaultUploadQuality: "auto",
  autoDownloadWifi: true,
  autoDownloadMobile: false,
  noiseSuppression: "standard",
  echoCancellation: true,
  autoGainControl: true,
  microphoneMode: "phone",
  callAudioRoute: "auto",
  callQuality: "auto",
  screenShareQuality: "auto",
  pushToTalk: false,
  cooperativeMatureContent: false,
};

/** Safe before an authenticated bootstrap: optional network features fail closed. */
export const defaultRuntimeCapabilities: RuntimeCapabilities = {
  schemaVersion: 1,
  revision: 0,
  sourceRevision: "uninitialized",
  uploads: false,
  calls: false,
  activities: false,
  servers: false,
  maxUploadBytes: 0,
};

export function productRuntimeCapabilities(capabilities: RuntimeCapabilities): RuntimeCapabilities {
  return {
    ...capabilities,
    servers: productCapabilities.servers && capabilities.servers,
  };
}

export function productServerProjection(input: Pick<BootstrapPayload, "servers" | "categories" | "channels">): Pick<BootstrapPayload, "servers" | "categories" | "channels"> {
  return productCapabilities.servers
    ? { servers: input.servers, categories: input.categories, channels: input.channels }
    : { servers: [], categories: [], channels: [] };
}

export function appStateBootstrap(state: AppState): BootstrapPayload | null {
  if (!state.me) return null;
  const serverProjection = productServerProjection(state);
  return {
    me: { ...state.me, isAdmin: state.me.isAdmin === true },
    conversations: state.conversations,
    ...serverProjection,
    friends: state.friends,
    settings: state.settings,
    eventCursor: state.eventCursor,
    capabilities: productRuntimeCapabilities(state.capabilities),
  };
}
