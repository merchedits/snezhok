import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import type {
  AppSettings,
  Attachment,
  BootstrapPayload,
  ChannelCategory,
  ChannelSummary,
  ConversationSummary,
  FriendEntry,
  Message,
  Presence,
  ServerSummary,
  UserSummary,
} from "@snezhok/contracts";

import { api, ApiError } from "../lib/api";
import { boundedMessageWindow } from "../lib/cachePolicy";
import { clearMediaCache } from "../lib/mediaCache";
import { cachedHistoryCursor } from "../lib/offlineCachePolicy";
import { clearLocalData, readCache, readCachedMessagePage, readDrafts, readOutbox, writeCacheDelta, writeDrafts, writeOutbox, type OfflineCacheDelta } from "../lib/offlineRepository";
import { clearSession, readSession, writeSession } from "../lib/secureSession";
import { mergeAcknowledgedPatch, rollbackRejectedPatch } from "../lib/settingsSync";
import type { MessageCreateInput, OutboxEntry, SettingsPatch, UploadInput } from "../types";
import type { ChatFolder, ScheduledMessage } from "../types";
import { applyConversationPreview } from "./conversationPreview";
import { upsertConversation } from "./conversationIdentity";
import { markMessageDeleted, mergeMessages as mergeUnboundedMessages, reconcilePinnedMessages } from "./messageReconciliation";
import { enqueueOutbox, replayOutbox, resolveOutboxMessageId } from "./outboxReliability";

type Phase = "booting" | "signed-out" | "ready" | "error";

interface AppState {
  phase: Phase;
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
  messages: Record<string, Message[]>;
  messagePagination: Record<string, { nextCursor: number | null; initialized: boolean }>;
  drafts: Record<string, string>;
  folders: ChatFolder[];
  scheduledMessages: ScheduledMessage[];
  outbox: OutboxEntry[];
  uploadProgress: number | null;
  initialize: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (input: { email: string; username: string; password: string }) => Promise<void>;
  clearError: () => void;
  signOut: () => Promise<void>;
  setOnline: (online: boolean) => void;
  refreshBootstrap: (options?: { force?: boolean; silent?: boolean }) => Promise<void>;
  refreshProductivity: () => Promise<void>;
  loadMessages: (streamId: string, before?: number) => Promise<void>;
  loadOlderMessages: (streamId: string) => Promise<void>;
  loadMessageContext: (streamId: string, messageId: string) => Promise<void>;
  markStreamRead: (streamId: string, sequence: number) => Promise<void>;
  markStreamUnread: (streamId: string, sequence?: number) => Promise<void>;
  loadPinnedMessages: (streamId: string) => Promise<void>;
  uploadAttachment: (input: UploadInput) => Promise<Attachment>;
  cancelUpload: () => Promise<void>;
  sendMessage: (streamId: string, input: Omit<MessageCreateInput, "clientId" | "silent"> & { silent?: boolean }, optimisticAttachments?: Attachment[]) => Promise<void>;
  forwardMessage: (messageId: string, targetStreamId: string) => Promise<Message>;
  editMessage: (message: Message, text: string) => Promise<void>;
  toggleReaction: (message: Message, emoji: string) => Promise<void>;
  deleteMessage: (message: Message, scope: "me" | "everyone") => Promise<void>;
  setMessagePinned: (message: Message, pinned: boolean) => Promise<void>;
  retryOutbox: () => Promise<void>;
  applyMessage: (message: Message, eventKind?: "created" | "updated") => void;
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
};

function toBootstrap(state: AppState): BootstrapPayload | null {
  if (!state.me) return null;
  return {
    me: state.me,
    conversations: state.conversations,
    servers: state.servers,
    categories: state.categories,
    channels: state.channels,
    friends: state.friends,
    settings: state.settings,
    eventCursor: state.eventCursor,
  };
}

let persistenceQueue: Promise<void> = Promise.resolve();
let settingsSyncQueue: Promise<void> = Promise.resolve();
let draftPersistenceQueue: Promise<void> = Promise.resolve();

interface PersistenceRequest {
  bootstrap?: boolean;
  outbox?: boolean;
  streamIds?: Iterable<string>;
  removedStreamIds?: Iterable<string>;
  removedMessages?: Iterable<{ streamId: string; messageId: string }>;
}

let pendingBootstrapPersistence = false;
let pendingOutboxPersistence = false;
const pendingMessageStreams = new Set<string>();
const pendingRemovedStreams = new Set<string>();
const pendingRemovedMessages = new Map<string, Set<string>>();
let persistenceEpoch = 0;

function markPersistence(request: PersistenceRequest): void {
  pendingBootstrapPersistence ||= Boolean(request.bootstrap);
  pendingOutboxPersistence ||= Boolean(request.outbox);
  for (const streamId of request.streamIds ?? []) {
    if (pendingRemovedStreams.has(streamId)) continue;
    pendingMessageStreams.add(streamId);
  }
  for (const streamId of request.removedStreamIds ?? []) {
    pendingMessageStreams.delete(streamId);
    pendingRemovedStreams.add(streamId);
    pendingRemovedMessages.delete(streamId);
  }
  for (const { streamId, messageId } of request.removedMessages ?? []) {
    if (pendingRemovedStreams.has(streamId)) continue;
    const ids = pendingRemovedMessages.get(streamId) ?? new Set<string>();
    ids.add(messageId);
    pendingRemovedMessages.set(streamId, ids);
  }
}

function flushPersistence(): Promise<void> {
  const writeBootstrap = pendingBootstrapPersistence;
  const writeOutboxSnapshot = pendingOutboxPersistence;
  const streamIds = [...pendingMessageStreams];
  const removedStreamIds = [...pendingRemovedStreams];
  const removedMessageIds = Object.fromEntries([...pendingRemovedMessages].map(([streamId, ids]) => [streamId, [...ids]]));
  if (!writeBootstrap && !writeOutboxSnapshot && streamIds.length === 0 && removedStreamIds.length === 0 && Object.keys(removedMessageIds).length === 0) return persistenceQueue;

  pendingBootstrapPersistence = false;
  pendingOutboxPersistence = false;
  pendingMessageStreams.clear();
  pendingRemovedStreams.clear();
  pendingRemovedMessages.clear();
  const state = useAppStore.getState();
  const epoch = persistenceEpoch;
  const delta: OfflineCacheDelta = { cachedAt: Date.now() };
  if (writeBootstrap) delta.bootstrap = toBootstrap(state);
  if (streamIds.length) delta.streams = Object.fromEntries(streamIds.map((streamId) => [streamId, state.messages[streamId] ?? []]));
  if (removedStreamIds.length) delta.removedStreamIds = removedStreamIds;
  if (Object.keys(removedMessageIds).length) delta.removedMessageIds = removedMessageIds;
  const outbox = state.outbox;
  const retryRequest: PersistenceRequest = {
    ...(writeBootstrap ? { bootstrap: true } : {}),
    ...(writeOutboxSnapshot ? { outbox: true } : {}),
    ...(streamIds.length ? { streamIds } : {}),
    ...(removedStreamIds.length ? { removedStreamIds } : {}),
    ...(Object.keys(removedMessageIds).length ? {
      removedMessages: Object.entries(removedMessageIds).flatMap(([streamId, messageIds]) => messageIds.map((messageId) => ({ streamId, messageId }))),
    } : {}),
  };
  persistenceQueue = persistenceQueue.catch(() => undefined).then(async () => {
    await Promise.all([
      writeBootstrap || streamIds.length || removedStreamIds.length || Object.keys(removedMessageIds).length ? writeCacheDelta(delta) : Promise.resolve(),
      writeOutboxSnapshot ? writeOutbox(outbox) : Promise.resolve(),
    ]);
  }).catch((error) => {
    // A transient disk failure must not silently discard the dirty projection.
    // Re-snapshot current state on the retry rather than replaying stale JSON.
    if (epoch === persistenceEpoch) markPersistence(retryRequest);
    if (epoch === persistenceEpoch && !persistenceTimer) {
      persistenceTimer = setTimeout(() => {
        persistenceTimer = null;
        void flushPersistence().catch((retryError) => console.warn("Could not retry offline cache persistence", retryError));
      }, 2_000);
    }
    throw error;
  });
  return persistenceQueue;
}

function persistState(request: PersistenceRequest): Promise<void> {
  markPersistence(request);
  if (persistenceTimer) clearTimeout(persistenceTimer);
  persistenceTimer = null;
  return flushPersistence();
}

let bootstrapRefresh: Promise<void> | null = null;
let lastBootstrapCompletedAt = 0;
let productivityRefresh: Promise<void> | null = null;
let lastProductivityCompletedAt = 0;
let persistenceTimer: ReturnType<typeof setTimeout> | null = null;
let draftPersistenceTimer: ReturnType<typeof setTimeout> | null = null;
const messageLoads = new Map<string, Promise<void>>();
const latestMessageLoads = new Map<string, number>();
const pinnedMessageLoads = new Map<string, Promise<void>>();
const latestPinnedMessageLoads = new Map<string, number>();
const reactionSyncQueues = new Map<string, Promise<void>>();
const remoteDraftTimers = new Map<string, ReturnType<typeof setTimeout>>();
let outboxRetry: Promise<void> | null = null;

function schedulePersistence(request: PersistenceRequest): void {
  markPersistence(request);
  if (persistenceTimer) clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    persistenceTimer = null;
    void flushPersistence().catch((error) => console.warn("Could not persist offline cache", error));
    // Cache I/O is deliberately kept outside navigation and interaction frames.
    // Realtime bursts coalesce into incremental dirty-stream transactions.
  }, 700);
}

function cancelScheduledPersistence(): void {
  persistenceEpoch += 1;
  if (persistenceTimer) clearTimeout(persistenceTimer);
  persistenceTimer = null;
  pendingBootstrapPersistence = false;
  pendingOutboxPersistence = false;
  pendingMessageStreams.clear();
  pendingRemovedStreams.clear();
  pendingRemovedMessages.clear();
}

function scheduleDraftPersistence(): void {
  if (draftPersistenceTimer) clearTimeout(draftPersistenceTimer);
  draftPersistenceTimer = setTimeout(() => {
    draftPersistenceTimer = null;
    const drafts = useAppStore.getState().drafts;
    draftPersistenceQueue = draftPersistenceQueue.catch(() => undefined).then(() => writeDrafts(drafts));
  }, 350);
}

export const useAppStore = create<AppState>((set, get) => ({
  phase: "booting",
  error: null,
  online: true,
  syncing: false,
  eventCursor: 0,
  me: null,
  conversations: [],
  servers: [],
  categories: [],
  channels: [],
  friends: [],
  settings: defaultSettings,
  messages: {},
  messagePagination: {},
  drafts: {},
  folders: [],
  scheduledMessages: [],
  outbox: [],
  uploadProgress: null,

  initialize: async () => {
    const [session, cache, outbox, drafts] = await Promise.all([readSession(), readCache(), readOutbox(), readDrafts()]);
    if (!session) {
      set({ phase: "signed-out", outbox: [] });
      return;
    }
    const cached = cache.bootstrap;
    set({
      phase: cached ? "ready" : "booting",
      me: cached?.me ?? null,
      conversations: cached?.conversations ?? [],
      servers: cached?.servers ?? [],
      categories: cached?.categories ?? [],
      channels: cached?.channels ?? [],
      friends: cached?.friends ?? [],
      settings: { ...defaultSettings, ...(cached?.settings ?? {}) },
      messages: cache.messages,
      drafts,
      outbox,
      eventCursor: cached?.eventCursor ?? 0,
      messagePagination: Object.fromEntries(Object.keys(cache.messages).map((streamId) => [streamId, { nextCursor: null, initialized: false }])),
    });
    try {
      await get().refreshBootstrap({ force: true });
      await get().refreshProductivity().catch(() => undefined);
      await get().retryOutbox();
    } catch (error) {
      if (!cached) set({ phase: "error", error: error instanceof Error ? error.message : "Unable to load Snezhok" });
    }
  },

  signIn: async (username, password) => {
    set({ error: null });
    try {
      const result = await api.login(username.trim(), password);
      await writeSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: Date.now() + result.expiresIn * 1_000,
      });
      set({ me: result.user });
      await get().refreshBootstrap({ force: true });
      await get().refreshProductivity().catch(() => undefined);
    } catch (error) {
      await clearSession();
      set({ phase: "signed-out", error: error instanceof Error ? error.message : "Sign in failed" });
      throw error;
    }
  },

  signUp: async (input) => {
    set({ error: null });
    try {
      const result = await api.register(input);
      await writeSession({ accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: Date.now() + result.expiresIn * 1_000 });
      set({ me: result.user });
      await get().refreshBootstrap({ force: true });
      await get().refreshProductivity().catch(() => undefined);
    } catch (error) {
      await clearSession();
      set({ phase: "signed-out", error: error instanceof Error ? error.message : "Registration failed" });
      throw error;
    }
  },

  clearError: () => set({ error: null }),

  signOut: async () => {
    cancelScheduledPersistence();
    if (draftPersistenceTimer) clearTimeout(draftPersistenceTimer);
    draftPersistenceTimer = null;
    lastBootstrapCompletedAt = 0;
    lastProductivityCompletedAt = 0;
    productivityRefresh = null;
    latestMessageLoads.clear();
    latestPinnedMessageLoads.clear();
    for (const timer of remoteDraftTimers.values()) clearTimeout(timer);
    remoteDraftTimers.clear();
    await Promise.all([persistenceQueue.catch(() => undefined), draftPersistenceQueue.catch(() => undefined)]);
    const pushInstallationId = await AsyncStorage.getItem("@snezhok/push-installation/v1").catch(() => null);
    if (pushInstallationId) await api.unregisterPushDevice(pushInstallationId).catch(() => undefined);
    await api.cancelUpload().catch(() => undefined);
    await Promise.all([clearSession(), clearLocalData(), clearMediaCache().catch(() => undefined)]);
    set({
      phase: "signed-out",
      error: null,
      me: null,
      conversations: [],
      servers: [],
      categories: [],
      channels: [],
      friends: [],
      settings: defaultSettings,
      messages: {},
      messagePagination: {},
      drafts: {},
      folders: [],
      scheduledMessages: [],
      outbox: [],
      eventCursor: 0,
      uploadProgress: null,
    });
  },

  setOnline: (online) => {
    if (get().online === online) return;
    set({ online });
    if (online) {
      void get().refreshBootstrap({ force: true, silent: true });
      void get().refreshProductivity().catch(() => undefined);
      void get().retryOutbox();
    }
  },

  refreshBootstrap: (options = {}) => {
    if (!get().online) return Promise.resolve();
    if (bootstrapRefresh) return bootstrapRefresh;
    if (!options.force && Date.now() - lastBootstrapCompletedAt < 30_000) return Promise.resolve();
    if (!options.silent) set({ syncing: true });
    bootstrapRefresh = (async () => {
      try {
        const payload = await api.bootstrap();
        set((state) => ({
          phase: "ready",
          error: null,
          syncing: false,
          me: payload.me,
          conversations: reconcileBootstrapConversations(state, payload.conversations),
          servers: payload.servers,
          categories: payload.categories,
          channels: payload.channels.map((channel) => state.outbox.some((entry) => entry.kind === "read" && entry.streamId === channel.id)
            ? { ...channel, unreadCount: 0, mentionCount: 0 }
            : channel),
          friends: payload.friends,
          settings: payload.settings,
          eventCursor: payload.eventCursor,
        }));
        lastBootstrapCompletedAt = Date.now();
        schedulePersistence({ bootstrap: true });
      } catch (error) {
        set({ syncing: false });
        const session = await readSession();
        if (!session) set({ phase: "signed-out" });
        throw error;
      }
    })().finally(() => {
      bootstrapRefresh = null;
    });
    return bootstrapRefresh;
  },

  refreshProductivity: () => {
    if (!get().online) return Promise.resolve();
    if (productivityRefresh) return productivityRefresh;
    if (Date.now() - lastProductivityCompletedAt < 30_000) return Promise.resolve();
    productivityRefresh = (async () => {
      const productivity = await api.productivity();
      const remoteDrafts = Object.fromEntries(productivity.drafts.map((draft) => [draft.streamId, draft.text]));
      const localDrafts = get().drafts;
      const mergedDrafts = { ...remoteDrafts, ...localDrafts };
      const dirtyLocalDrafts = Object.entries(localDrafts).filter(([streamId, text]) => (remoteDrafts[streamId] ?? "") !== text);
      set({
        drafts: mergedDrafts,
        folders: productivity.folders,
        scheduledMessages: productivity.scheduled,
      });
      lastProductivityCompletedAt = Date.now();
      scheduleDraftPersistence();
      // Local values (including empty tombstones) win after offline use, then
      // are pushed back so a second device observes the same draft state.
      await Promise.all(dirtyLocalDrafts.map(([streamId, text]) => api.saveDraft(streamId, text, null).catch(() => undefined)));
    })().finally(() => { productivityRefresh = null; });
    return productivityRefresh;
  },

  loadMessages: (streamId, before) => {
    const key = `${streamId}:${before ?? "latest"}`;
    const active = messageLoads.get(key);
    if (active) return active;
    if (before === undefined && (get().messages[streamId]?.length ?? 0) > 0 && Date.now() - (latestMessageLoads.get(streamId) ?? 0) < 15_000) return Promise.resolve();
    const loading = (async () => {
      if (before === undefined) {
        const cached = await readCachedMessagePage(streamId, before, 40).catch(() => []);
        if (cached.length) {
          set((state) => ({
            messages: { ...state.messages, [streamId]: boundedMessageWindow(mergeMessages(state.messages[streamId] ?? [], cached)) },
          }));
        }
      }
      if (!get().online) return;
      const page = await api.messages(streamId, before);
      set((state) => ({
        messages: {
          ...state.messages,
          [streamId]: boundedMessageWindow(mergeUnboundedMessages(state.messages[streamId] ?? [], page.items), 300, before === undefined ? "latest" : "older"),
        },
        messagePagination: {
          ...state.messagePagination,
          [streamId]: { nextCursor: page.nextCursor === null ? null : Number(page.nextCursor), initialized: true },
        },
      }));
      if (before === undefined) latestMessageLoads.set(streamId, Date.now());
      schedulePersistence({ streamIds: [streamId] });
    })().finally(() => messageLoads.delete(key));
    messageLoads.set(key, loading);
    return loading;
  },

  loadOlderMessages: async (streamId) => {
    const current = get().messages[streamId] ?? [];
    const earliestSequence = cachedHistoryCursor(current);
    if (earliestSequence !== undefined) {
      const cached = await readCachedMessagePage(streamId, earliestSequence, 60).catch(() => []);
      if (cached.length) {
        set((state) => ({
          messages: { ...state.messages, [streamId]: boundedMessageWindow(mergeUnboundedMessages(state.messages[streamId] ?? [], cached), 300, "older") },
        }));
        return;
      }
    }
    const pagination = get().messagePagination[streamId];
    if (!pagination?.initialized) {
      await get().loadMessages(streamId);
      return;
    }
    if (pagination.nextCursor === null) return;
    await get().loadMessages(streamId, pagination.nextCursor);
  },

  loadMessageContext: async (streamId, messageId) => {
    if ((get().messages[streamId] ?? []).some((message) => message.id === messageId) || !get().online) return;
    const context = await api.messageContext(messageId);
    if (context.streamId !== streamId) throw new Error("Reply target belongs to another chat");
    set((state) => ({ messages: { ...state.messages, [streamId]: boundedMessageWindow(mergeMessages(state.messages[streamId] ?? [], context.items)) } }));
    schedulePersistence({ streamIds: [streamId] });
  },

  markStreamRead: async (streamId, sequence) => {
    if (sequence < 0) return;
    // Clear the badge immediately. The server write remains idempotent and is
    // retried whenever the focused chat receives another message.
    const shouldPersist = get().conversations.some((conversation) => conversation.id === streamId && (conversation.unreadCount > 0 || conversation.mentionCount > 0))
      || get().channels.some((channel) => channel.id === streamId && (channel.unreadCount > 0 || channel.mentionCount > 0));
    if (shouldPersist) {
      set((state) => ({
        conversations: state.conversations.map((conversation) => conversation.id === streamId
          ? { ...conversation, unreadCount: 0, mentionCount: 0 }
          : conversation),
        channels: state.channels.map((channel) => channel.id === streamId
          ? { ...channel, unreadCount: 0, mentionCount: 0 }
          : channel),
      }));
      schedulePersistence({ bootstrap: true });
    }
    const entry: OutboxEntry = { kind: "read", id: Crypto.randomUUID(), streamId, sequence, queuedAt: Date.now(), attempts: 0 };
    set((state) => ({ outbox: enqueueOutbox(state.outbox, entry) }));
    schedulePersistence({ outbox: true });
    if (!get().online) return;
    try {
      const acknowledged = await api.markRead(streamId, sequence);
      set((state) => ({
        outbox: state.outbox.filter((item) => item.id !== entry.id),
        conversations: state.conversations.map((conversation) => conversation.id === streamId && acknowledged.sequence >= sequence
          ? { ...conversation, unreadCount: 0, mentionCount: 0 }
          : conversation),
        channels: state.channels.map((channel) => channel.id === streamId && acknowledged.sequence >= sequence
          ? { ...channel, unreadCount: 0, mentionCount: 0 }
          : channel),
      }));
      schedulePersistence({ bootstrap: true, outbox: true });
    } catch (error) {
      if (!isRetryable(error)) {
        set((state) => ({ outbox: state.outbox.filter((item) => item.id !== entry.id) }));
        schedulePersistence({ outbox: true });
      }
      throw error;
    }
  },

  markStreamUnread: async (streamId, sequence) => {
    const previousConversationCount = get().conversations.find((item) => item.id === streamId)?.unreadCount ?? 0;
    const previousChannelCount = get().channels.find((item) => item.id === streamId)?.unreadCount ?? 0;
    set((state) => ({
      conversations: state.conversations.map((conversation) => conversation.id === streamId
        ? { ...conversation, unreadCount: Math.max(1, conversation.unreadCount) }
        : conversation),
      channels: state.channels.map((channel) => channel.id === streamId
        ? { ...channel, unreadCount: Math.max(1, channel.unreadCount) }
        : channel),
    }));
    schedulePersistence({ bootstrap: true });
    try {
      await api.markUnread(streamId, sequence);
    } catch (error) {
      set((state) => ({
        conversations: state.conversations.map((conversation) => conversation.id === streamId && conversation.unreadCount === 1
          ? { ...conversation, unreadCount: previousConversationCount }
          : conversation),
        channels: state.channels.map((channel) => channel.id === streamId && channel.unreadCount === 1
          ? { ...channel, unreadCount: previousChannelCount }
          : channel),
      }));
      schedulePersistence({ bootstrap: true });
      throw error;
    }
  },

  loadPinnedMessages: (streamId) => {
    if (!get().online) return Promise.resolve();
    const active = pinnedMessageLoads.get(streamId);
    if (active) return active;
    if (Date.now() - (latestPinnedMessageLoads.get(streamId) ?? 0) < 30_000) return Promise.resolve();
    const loading = (async () => {
      const pinned = await api.pinnedMessages(streamId);
      set((state) => ({
        messages: { ...state.messages, [streamId]: boundedMessageWindow(reconcilePinnedMessages(state.messages[streamId] ?? [], pinned)) },
      }));
      latestPinnedMessageLoads.set(streamId, Date.now());
      schedulePersistence({ streamIds: [streamId] });
    })().finally(() => pinnedMessageLoads.delete(streamId));
    pinnedMessageLoads.set(streamId, loading);
    return loading;
  },

  uploadAttachment: async (input) => {
    set({ uploadProgress: 0 });
    try {
      return await api.upload(
        { ...input, stripLocation: input.stripLocation ?? get().settings.stripMediaLocation },
        (uploadProgress) => set({ uploadProgress }),
      );
    } catch (error) {
      set({ uploadProgress: null });
      throw error;
    }
  },

  cancelUpload: async () => {
    await api.cancelUpload();
    set({ uploadProgress: null });
  },

  sendMessage: async (streamId, partial, optimisticAttachments = []) => {
    const me = get().me;
    if (!me) throw new Error("No active session");
    const clientId = Crypto.randomUUID();
    const input: MessageCreateInput = { ...partial, clientId, silent: partial.silent ?? false };
    const existing = get().messages[streamId] ?? [];
    const optimistic: Message = {
      id: clientId,
      clientId,
      streamId,
      streamKind: get().channels.some((channel) => channel.id === streamId) ? "channel" : "conversation",
      sequence: (existing.at(-1)?.sequence ?? 0) + 1,
      sender: me,
      kind: input.kind,
      text: input.text,
      replyTo: null,
      forwardedFrom: null,
      attachments: optimisticAttachments,
      reactions: [],
      createdAt: Date.now(),
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      silent: input.silent,
      readByOthers: false,
      pending: true,
      failed: false,
    };
    set((state) => ({
      conversations: applyConversationPreview(state.conversations, optimistic),
      messages: { ...state.messages, [streamId]: mergeMessages(state.messages[streamId] ?? [], [optimistic]) },
    }));

    if (!get().online) {
      const entry: OutboxEntry = { kind: "message", id: clientId, streamId, input, queuedAt: Date.now(), attempts: 0 };
      set((state) => ({ outbox: enqueueOutbox(state.outbox, entry) }));
      await persistState({ bootstrap: true, outbox: true, streamIds: [streamId] });
      return;
    }

    try {
      const saved = await api.createMessage(streamId, input);
      set((state) => ({
        conversations: applyConversationPreview(state.conversations, saved),
        messages: {
          ...state.messages,
          [streamId]: mergeMessages(state.messages[streamId] ?? [], [saved]),
        },
      }));
    } catch (error) {
      const retryable = isRetryable(error);
      const entry: OutboxEntry = { kind: "message", id: clientId, streamId, input, queuedAt: Date.now(), attempts: 1 };
      set((state) => ({
        outbox: retryable ? enqueueOutbox(state.outbox.filter((item) => item.id !== clientId), entry) : state.outbox.filter((item) => item.id !== clientId),
        messages: {
          ...state.messages,
          [streamId]: (state.messages[streamId] ?? []).map((message) =>
            message.id === clientId ? { ...message, pending: false, failed: true } : message,
          ),
        },
      }));
    }
    schedulePersistence({ bootstrap: true, outbox: true, streamIds: [streamId] });
  },

  forwardMessage: async (messageId, targetStreamId) => {
    const me = get().me;
    const source = findMessage(get().messages, messageId);
    if (!me || !source) throw new Error("Message is no longer available");
    const clientId = Crypto.randomUUID();
    const existing = get().messages[targetStreamId] ?? [];
    const optimistic: Message = {
      ...source,
      id: clientId,
      clientId,
      streamId: targetStreamId,
      streamKind: get().channels.some((channel) => channel.id === targetStreamId) ? "channel" : "conversation",
      sequence: (existing.at(-1)?.sequence ?? 0) + 1,
      sender: me,
      forwardedFrom: { id: source.id, senderId: source.sender.id, senderName: source.sender.displayName, text: source.text, kind: source.kind, createdAt: source.createdAt },
      reactions: [],
      createdAt: Date.now(),
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      silent: false,
      readByOthers: false,
      pending: true,
      failed: false,
    };
    set((state) => ({
      conversations: applyConversationPreview(state.conversations, optimistic),
      messages: { ...state.messages, [targetStreamId]: mergeMessages(state.messages[targetStreamId] ?? [], [optimistic]) },
    }));
    schedulePersistence({ bootstrap: true, streamIds: [targetStreamId] });
    const entry: OutboxEntry = { kind: "forward", id: clientId, streamId: targetStreamId, sourceMessageId: messageId, clientId, queuedAt: Date.now(), attempts: 0 };
    if (!get().online) {
      set((state) => ({ outbox: enqueueOutbox(state.outbox, entry) }));
      await persistState({ bootstrap: true, outbox: true, streamIds: [targetStreamId] });
      return optimistic;
    }
    let saved: Message;
    try {
      saved = await api.forwardMessage(messageId, targetStreamId, clientId);
    } catch (error) {
      const retryable = isRetryable(error);
      set((state) => ({
        outbox: retryable ? enqueueOutbox(state.outbox, { ...entry, attempts: 1 }) : state.outbox,
        messages: { ...state.messages, [targetStreamId]: (state.messages[targetStreamId] ?? []).map((message) => message.id === clientId ? { ...message, pending: false, failed: true } : message) },
      }));
      schedulePersistence({ outbox: true, streamIds: [targetStreamId] });
      if (!retryable) throw error;
      return optimistic;
    }
    set((state) => ({
      conversations: applyConversationPreview(state.conversations, saved),
      messages: { ...state.messages, [targetStreamId]: mergeMessages(state.messages[targetStreamId] ?? [], [saved]) },
    }));
    schedulePersistence({ bootstrap: true, streamIds: [targetStreamId] });
    return saved;
  },

  editMessage: async (message, text) => {
    const value = text.trim();
    if (!value || value === message.text) return;
    const optimistic: Message = { ...message, text: value, editedAt: Date.now() };
    const entry: OutboxEntry = { kind: "edit", id: Crypto.randomUUID(), streamId: message.streamId, messageId: message.id, text: value, previous: message, queuedAt: Date.now(), attempts: 0 };
    set((state) => ({
      conversations: applyConversationPreview(state.conversations, optimistic),
      messages: { ...state.messages, [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [optimistic]) },
    }));
    schedulePersistence({ bootstrap: true, streamIds: [message.streamId] });
    if (!get().online) {
      set((state) => ({ outbox: enqueueOutbox(state.outbox, entry) }));
      await persistState({ outbox: true, streamIds: [message.streamId] });
      return;
    }
    try {
      const saved = await api.editMessage(message.id, value);
      set((state) => {
        const current = (state.messages[message.streamId] ?? []).find((item) => item.id === message.id);
        if (!current || current.text !== value || current.deletedAt) return state;
        return {
          conversations: applyConversationPreview(state.conversations, saved),
          messages: { ...state.messages, [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [saved]) },
        };
      });
    } catch (error) {
      if (isRetryable(error)) {
        set((state) => ({ outbox: enqueueOutbox(state.outbox, { ...entry, attempts: 1 }) }));
      } else {
        set((state) => ({
          conversations: applyConversationPreview(state.conversations, message),
          messages: { ...state.messages, [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [message]) },
        }));
        throw error;
      }
    } finally {
      schedulePersistence({ bootstrap: true, outbox: true, streamIds: [message.streamId] });
    }
  },

  toggleReaction: async (message, emoji) => {
    const current = (get().messages[message.streamId] ?? []).find((candidate) => candidate.id === message.id) ?? message;
    const active = !current.reactions.some((reaction) => reaction.emoji === emoji && reaction.reacted);
    const optimistic = { ...current, reactions: updateOptimisticReaction(current.reactions, emoji, active, get().me?.id) };
    const entry: OutboxEntry = { kind: "reaction", id: Crypto.randomUUID(), streamId: current.streamId, messageId: current.id, emoji, active, previous: current, queuedAt: Date.now(), attempts: 0 };
    set((state) => ({ messages: { ...state.messages, [current.streamId]: mergeMessages(state.messages[current.streamId] ?? [], [optimistic]) } }));
    schedulePersistence({ streamIds: [current.streamId] });
    if (!get().online) {
      set((state) => ({ outbox: enqueueOutbox(state.outbox, entry) }));
      await persistState({ outbox: true, streamIds: [current.streamId] });
      return;
    }
    const queueKey = `${current.id}\u0000${emoji}`;
    const previousOperation = reactionSyncQueues.get(queueKey) ?? Promise.resolve();
    const operation = previousOperation.then(async () => {
      try {
        const saved = await api.setReaction(current.id, emoji, active);
        set((state) => {
          const live = (state.messages[current.streamId] ?? []).find((candidate) => candidate.id === current.id);
          if (!live || hasActiveReaction(live, emoji) !== active) return state;
          return { messages: { ...state.messages, [current.streamId]: mergeMessages(state.messages[current.streamId] ?? [], [saved]) } };
        });
        schedulePersistence({ streamIds: [current.streamId] });
      } catch (error) {
        if (isRetryable(error)) {
          set((state) => ({ outbox: enqueueOutbox(state.outbox, { ...entry, attempts: 1 }) }));
          schedulePersistence({ outbox: true, streamIds: [current.streamId] });
          return;
        }
        set((state) => {
          const live = (state.messages[current.streamId] ?? []).find((candidate) => candidate.id === current.id);
          if (!live || hasActiveReaction(live, emoji) !== active) return state;
          return { messages: { ...state.messages, [current.streamId]: mergeMessages(state.messages[current.streamId] ?? [], [current]) } };
        });
        schedulePersistence({ streamIds: [current.streamId] });
        throw error;
      }
    });
    reactionSyncQueues.set(queueKey, operation.catch(() => undefined));
    await operation;
  },

  deleteMessage: async (message, scope) => {
    const entry: OutboxEntry = { kind: "delete", id: Crypto.randomUUID(), streamId: message.streamId, messageId: message.id, scope, previous: message, queuedAt: Date.now(), attempts: 0 };
    set((state) => ({
      messages: {
        ...state.messages,
        [message.streamId]: scope === "me"
          ? (state.messages[message.streamId] ?? []).filter((item) => item.id !== message.id)
          : markMessageDeleted(state.messages[message.streamId] ?? [], message.id, Date.now(), true),
      },
    }));
    schedulePersistence({ streamIds: [message.streamId], ...(scope === "me" ? { removedMessages: [{ streamId: message.streamId, messageId: message.id }] } : {}) });
    if (!get().online) {
      set((state) => ({ outbox: enqueueOutbox(state.outbox, entry) }));
      await persistState({ outbox: true, streamIds: [message.streamId] });
      return;
    }
    if (scope === "me") {
      try {
        await api.hideMessage(message.id);
      } catch (error) {
        if (isRetryable(error)) {
          set((state) => ({ outbox: enqueueOutbox(state.outbox, { ...entry, attempts: 1 }) }));
          schedulePersistence({ outbox: true, streamIds: [message.streamId] });
          return;
        }
        set((state) => ({ messages: { ...state.messages, [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [message]) } }));
        schedulePersistence({ streamIds: [message.streamId] });
        throw error;
      }
      void get().refreshBootstrap({ force: true, silent: true });
      return;
    }
    let saved: Message;
    try {
      saved = await api.deleteMessage(message.id);
    } catch (error) {
      if (isRetryable(error)) {
        set((state) => ({ outbox: enqueueOutbox(state.outbox, { ...entry, attempts: 1 }) }));
        schedulePersistence({ outbox: true, streamIds: [message.streamId] });
        return;
      }
      set((state) => ({ messages: { ...state.messages, [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [message]) } }));
      schedulePersistence({ streamIds: [message.streamId] });
      throw error;
    }
    set((state) => ({
      conversations: applyConversationPreview(state.conversations, saved),
      messages: { ...state.messages, [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [saved]) },
    }));
    schedulePersistence({ bootstrap: true, streamIds: [message.streamId] });
    // The server may reveal the previous message as the new conversation
    // preview after deleting the latest one.
    void get().refreshBootstrap({ force: true, silent: true });
  },

  setMessagePinned: async (message, pinned) => {
    const optimistic = { ...message, pinnedAt: pinned ? Date.now() : null };
    const entry: OutboxEntry = { kind: "pin", id: Crypto.randomUUID(), streamId: message.streamId, messageId: message.id, pinned, previous: message, queuedAt: Date.now(), attempts: 0 };
    set((state) => ({ messages: { ...state.messages, [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [optimistic]) } }));
    schedulePersistence({ streamIds: [message.streamId] });
    if (!get().online) {
      set((state) => ({ outbox: enqueueOutbox(state.outbox, entry) }));
      await persistState({ outbox: true, streamIds: [message.streamId] });
      return;
    }
    let saved: Message;
    try {
      saved = await api.setMessagePinned(message.id, pinned);
    } catch (error) {
      if (isRetryable(error)) {
        set((state) => ({ outbox: enqueueOutbox(state.outbox, { ...entry, attempts: 1 }) }));
        schedulePersistence({ outbox: true, streamIds: [message.streamId] });
        return;
      }
      set((state) => ({ messages: { ...state.messages, [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [message]) } }));
      schedulePersistence({ streamIds: [message.streamId] });
      throw error;
    }
    set((state) => {
      const current = (state.messages[message.streamId] ?? []).find((item) => item.id === message.id);
      if (!current || Boolean(current.pinnedAt) !== pinned || current.deletedAt) return state;
      return { messages: { ...state.messages, [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [saved]) } };
    });
    schedulePersistence({ streamIds: [message.streamId] });
  },

  retryOutbox: async () => {
    if (!get().online || get().outbox.length === 0) return;
    if (outboxRetry) return outboxRetry;
    outboxRetry = (async () => {
      const snapshot = [...get().outbox];
      const acknowledgedIds = new Map<string, string>();
      await replayOutbox(snapshot, async (entry) => {
        try {
          if (entry.kind === "message") {
            const saved = await api.createMessage(entry.streamId, entry.input);
            acknowledgedIds.set(entry.id, saved.id);
            acknowledgedIds.set(entry.input.clientId, saved.id);
            set((state) => ({ conversations: applyConversationPreview(state.conversations, saved), messages: { ...state.messages, [entry.streamId]: mergeMessages(state.messages[entry.streamId] ?? [], [saved]) } }));
            return;
          }
          if (entry.kind === "forward") {
            const saved = await api.forwardMessage(resolveOutboxMessageId(entry.sourceMessageId, acknowledgedIds), entry.streamId, entry.clientId);
            acknowledgedIds.set(entry.id, saved.id);
            acknowledgedIds.set(entry.clientId, saved.id);
            set((state) => ({ conversations: applyConversationPreview(state.conversations, saved), messages: { ...state.messages, [entry.streamId]: mergeMessages(state.messages[entry.streamId] ?? [], [saved]) } }));
            return;
          }
          if (entry.kind === "read") {
            await api.markRead(entry.streamId, entry.sequence);
            set((state) => ({
              conversations: state.conversations.map((conversation) => conversation.id === entry.streamId ? { ...conversation, unreadCount: 0, mentionCount: 0 } : conversation),
              channels: state.channels.map((channel) => channel.id === entry.streamId ? { ...channel, unreadCount: 0, mentionCount: 0 } : channel),
            }));
            return;
          }
          if (entry.kind === "edit") {
            const messageId = resolveOutboxMessageId(entry.messageId, acknowledgedIds);
            const saved = await api.editMessage(messageId, entry.text);
            set((state) => {
              const live = (state.messages[entry.streamId] ?? []).find((message) => message.id === messageId);
              if (!live || live.text !== entry.text || live.deletedAt) return state;
              return { conversations: applyConversationPreview(state.conversations, saved), messages: { ...state.messages, [entry.streamId]: mergeMessages(state.messages[entry.streamId] ?? [], [saved]) } };
            });
            return;
          }
          if (entry.kind === "delete") {
            const messageId = resolveOutboxMessageId(entry.messageId, acknowledgedIds);
            if (entry.scope === "me") {
              await api.hideMessage(messageId);
              set((state) => ({ messages: { ...state.messages, [entry.streamId]: (state.messages[entry.streamId] ?? []).filter((message) => message.id !== messageId) } }));
            }
            else {
              const saved = await api.deleteMessage(messageId);
              set((state) => ({ conversations: applyConversationPreview(state.conversations, saved), messages: { ...state.messages, [entry.streamId]: mergeMessages(state.messages[entry.streamId] ?? [], [saved]) } }));
            }
            return;
          }
          if (entry.kind === "pin") {
            const messageId = resolveOutboxMessageId(entry.messageId, acknowledgedIds);
            const saved = await api.setMessagePinned(messageId, entry.pinned);
            set((state) => {
              const live = (state.messages[entry.streamId] ?? []).find((message) => message.id === messageId);
              if (!live || Boolean(live.pinnedAt) !== entry.pinned || live.deletedAt) return state;
              return { messages: { ...state.messages, [entry.streamId]: mergeMessages(state.messages[entry.streamId] ?? [], [saved]) } };
            });
            return;
          }
          const messageId = resolveOutboxMessageId(entry.messageId, acknowledgedIds);
          const saved = await api.setReaction(messageId, entry.emoji, entry.active);
          set((state) => {
            const live = (state.messages[entry.streamId] ?? []).find((message) => message.id === messageId);
            if (!live || hasActiveReaction(live, entry.emoji) !== entry.active || live.deletedAt) return state;
            return { messages: { ...state.messages, [entry.streamId]: mergeMessages(state.messages[entry.streamId] ?? [], [saved]) } };
          });
        } catch (error) {
          if (isRetryable(error)) throw error;
          set((state) => restoreRejectedOutbox(state, entry));
        }
      }, (entry) => {
        set((state) => ({ outbox: state.outbox.filter((item) => item.id !== entry.id) }));
      }, (entry) => {
        set((state) => ({ outbox: state.outbox.map((item) => item.id === entry.id ? { ...item, attempts: item.attempts + 1 } : item) }));
      });
      await persistState({
        bootstrap: true,
        outbox: true,
        streamIds: new Set(snapshot.map((entry) => entry.streamId)),
      });
    })().finally(() => { outboxRetry = null; });
    return outboxRetry;
  },

  applyMessage: (message, eventKind = "updated") => {
    set((state) => {
      const existing = state.messages[message.streamId] ?? [];
      const alreadyKnown = existing.some((item) => item.id === message.id || Boolean(message.clientId && (item.clientId === message.clientId || item.id === message.clientId)));
      const incomingUnread = eventKind === "created" && !alreadyKnown && message.sender.id !== state.me?.id;
      return {
        conversations: applyConversationPreview(state.conversations, message).map((conversation) => conversation.id === message.streamId && incomingUnread
          ? { ...conversation, unreadCount: conversation.unreadCount + 1 }
          : conversation),
        channels: state.channels.map((channel) => channel.id === message.streamId && incomingUnread
          ? { ...channel, unreadCount: channel.unreadCount + 1 }
          : channel),
        messages: { ...state.messages, [message.streamId]: mergeMessages(existing, [message]) },
      };
    });
    latestMessageLoads.set(message.streamId, Date.now());
    schedulePersistence({ bootstrap: true, streamIds: [message.streamId] });
  },

  applyMessageDeleted: ({ id, streamId, deletedAt }) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [streamId]: markMessageDeleted(state.messages[streamId] ?? [], id, deletedAt),
      },
    }));
    schedulePersistence({ streamIds: [streamId] });
    void get().refreshBootstrap({ force: true, silent: true });
  },

  applyReadReceipt: ({ streamId, userId, sequence }) => {
    const me = get().me;
    if (!me || userId === me.id) return;
    let changed = false;
    set((state) => {
      const current = state.messages[streamId] ?? [];
      const messages = mapIfChanged(current, (message) => message.sender.id === me.id && message.sequence <= sequence && !message.readByOthers
        ? { ...message, readByOthers: true }
        : message);
      if (messages === current) return state;
      changed = true;
      return { messages: { ...state.messages, [streamId]: messages } };
    });
    if (changed) schedulePersistence({ streamIds: [streamId] });
  },

  applyConversation: (conversation) => {
    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    schedulePersistence({ bootstrap: true });
  },

  deleteConversation: async (conversationId) => {
    if (!get().online) throw new Error("Deleting a chat requires a connection");
    await api.deleteConversation(conversationId);
    get().removeConversation(conversationId);
  },

  removeConversation: (conversationId) => {
    set((state) => {
      const { [conversationId]: _removed, ...messages } = state.messages;
      return { conversations: state.conversations.filter((item) => item.id !== conversationId), messages };
    });
    latestMessageLoads.delete(conversationId);
    schedulePersistence({ bootstrap: true, removedStreamIds: [conversationId] });
  },

  applyPresence: (userId, presence, lastSeenAt) => {
    const updateUser = (user: UserSummary): UserSummary => {
      if (user.id !== userId || (user.presence === presence && user.lastSeenAt === lastSeenAt)) return user;
      return { ...user, presence, lastSeenAt };
    };
    set((state) => {
      const me = state.me ? updateUser(state.me) : null;
      const conversations = mapIfChanged(state.conversations, (conversation) => {
        const participants = mapIfChanged(conversation.participants, updateUser);
        return participants === conversation.participants ? conversation : { ...conversation, participants };
      });
      const friends = mapIfChanged(state.friends, (entry) => {
        const user = updateUser(entry.user);
        return user === entry.user ? entry : { ...entry, user };
      });
      const channels = mapIfChanged(state.channels, (channel) => {
        const connectedMembers = mapIfChanged(channel.connectedMembers, updateUser);
        return connectedMembers === channel.connectedMembers ? channel : { ...channel, connectedMembers };
      });
      if (me === state.me && conversations === state.conversations && friends === state.friends && channels === state.channels) return state;
      return { me, conversations, friends, channels };
    });
  },

  setDraft: (streamId, text) => {
    set((state) => {
      const drafts = { ...state.drafts };
      // Empty strings are intentional tombstones: they prevent an offline
      // deletion from being resurrected by an older server draft at startup.
      drafts[streamId] = text;
      return { drafts };
    });
    scheduleDraftPersistence();
    const previous = remoteDraftTimers.get(streamId);
    if (previous) clearTimeout(previous);
    if (get().online) remoteDraftTimers.set(streamId, setTimeout(() => {
      remoteDraftTimers.delete(streamId);
      void api.saveDraft(streamId, useAppStore.getState().drafts[streamId] ?? "", null).catch(() => undefined);
    }, 600));
  },

  scheduleTextMessage: async (streamId, partial, scheduledFor) => {
    if (!get().online) throw new Error("Scheduling requires a connection");
    const input: MessageCreateInput = { ...partial, clientId: Crypto.randomUUID() };
    const scheduled = await api.scheduleMessage(streamId, input, scheduledFor);
    set((state) => ({ scheduledMessages: [...state.scheduledMessages.filter((item) => item.id !== scheduled.id), scheduled].sort((a, b) => a.scheduledFor - b.scheduledFor) }));
  },

  cancelScheduledMessage: async (scheduledMessageId) => {
    if (!get().online) throw new Error("Scheduling requires a connection");
    await api.cancelScheduledMessage(scheduledMessageId);
    set((state) => ({ scheduledMessages: state.scheduledMessages.filter((item) => item.id !== scheduledMessageId) }));
  },

  createFolder: async (name, streams = []) => {
    if (!get().online) throw new Error("Folder changes require a connection");
    const folder = await api.createFolder(name, streams);
    set((state) => ({ folders: [...state.folders.filter((item) => item.id !== folder.id), folder].sort((a, b) => a.position - b.position) }));
  },

  setFolderMembership: async (folder, stream, included) => {
    if (!get().online) throw new Error("Folder changes require a connection");
    const streams = included
      ? [...folder.streams.filter((item) => item.streamId !== stream.streamId || item.streamKind !== stream.streamKind), stream]
      : folder.streams.filter((item) => item.streamId !== stream.streamId || item.streamKind !== stream.streamKind);
    const optimistic = { ...folder, streams };
    set((state) => ({ folders: state.folders.map((item) => item.id === folder.id ? optimistic : item) }));
    try {
      const saved = await api.updateFolder(folder.id, { streams });
      set((state) => ({ folders: state.folders.map((item) => item.id === folder.id ? saved : item) }));
    } catch (error) {
      set((state) => ({ folders: state.folders.map((item) => item.id === folder.id ? folder : item) }));
      throw error;
    }
  },

  deleteFolder: async (folderId) => {
    if (!get().online) throw new Error("Folder changes require a connection");
    await api.deleteFolder(folderId);
    set((state) => ({ folders: state.folders.filter((item) => item.id !== folderId) }));
  },

  setConversationPreference: async (conversation, patch) => {
    const optimistic: ConversationSummary = {
      ...conversation,
      pinned: patch.pinned ?? (patch.archived ? false : conversation.pinned),
      archived: patch.archived ?? (patch.pinned ? false : conversation.archived),
      muted: patch.muted ?? conversation.muted,
    };
    set((state) => ({ conversations: upsertConversation(state.conversations, optimistic) }));
    schedulePersistence({ bootstrap: true });
    if (!get().online) {
      set((state) => ({ conversations: upsertConversation(state.conversations, conversation) }));
      schedulePersistence({ bootstrap: true });
      throw new Error("Conversation settings require a connection");
    }
    try {
      const saved = await api.updateConversationPreferences(conversation.id, patch);
      set((state) => ({ conversations: upsertConversation(state.conversations, saved) }));
    } catch (error) {
      set((state) => ({ conversations: upsertConversation(state.conversations, conversation) }));
      throw error;
    } finally {
      schedulePersistence({ bootstrap: true });
    }
  },

  updateSettings: (patch) => {
    const previous = get().settings;
    const next = { ...previous, ...patch };
    set({ settings: next });
    schedulePersistence({ bootstrap: true });
    if (!get().online) return Promise.resolve();

    const operation = settingsSyncQueue.then(async () => {
      try {
        const saved = await api.updateSettings(patch);
        set((state) => ({ settings: mergeAcknowledgedPatch(state.settings, patch, saved) }));
        schedulePersistence({ bootstrap: true });
      } catch (error) {
        set((state) => ({ settings: rollbackRejectedPatch(state.settings, patch, previous) }));
        schedulePersistence({ bootstrap: true });
        throw error;
      }
    });
    settingsSyncQueue = operation.catch(() => undefined);
    return operation;
  },

  setEventCursor: (cursor) => {
    set((state) => ({ eventCursor: Math.max(state.eventCursor, cursor) }));
    schedulePersistence({ bootstrap: true });
  },
}));

function restoreRejectedOutbox(state: AppState, entry: OutboxEntry): Partial<AppState> {
  if (entry.kind === "message" || entry.kind === "forward") {
    return {
      messages: {
        ...state.messages,
        [entry.streamId]: (state.messages[entry.streamId] ?? []).map((message) => message.id === entry.id ? { ...message, pending: false, failed: true } : message),
      },
    };
  }
  if (entry.kind === "read") return {};
  const live = (state.messages[entry.streamId] ?? []).find((message) => message.id === entry.messageId);
  const stillCurrent = entry.kind === "edit" ? live?.text === entry.text
    : entry.kind === "pin" ? Boolean(live?.pinnedAt) === entry.pinned
      : entry.kind === "reaction" ? Boolean(live && hasActiveReaction(live, entry.emoji) === entry.active)
        : Boolean(live?.deletedAt && live.pending);
  if (!stillCurrent) return {};
  return {
    conversations: entry.kind === "edit" ? applyConversationPreview(state.conversations, entry.previous) : state.conversations,
    messages: { ...state.messages, [entry.streamId]: mergeMessages(state.messages[entry.streamId] ?? [], [entry.previous]) },
  };
}

function reconcileBootstrapConversations(state: AppState, incoming: ConversationSummary[]): ConversationSummary[] {
  const pendingReadStreams = new Set(state.outbox.filter((entry) => entry.kind === "read").map((entry) => entry.streamId));
  const localById = new Map(state.conversations.map((conversation) => [conversation.id, conversation]));
  return incoming.map((conversation) => {
    const local = localById.get(conversation.id);
    const optimisticPreview = local?.lastMessage && (state.messages[conversation.id] ?? []).some((message) =>
      (message.pending || message.failed) && (message.id === local.lastMessage?.id || message.clientId === local.lastMessage?.id));
    return {
      ...conversation,
      ...(optimisticPreview ? { lastMessage: local!.lastMessage, updatedAt: Math.max(conversation.updatedAt, local!.updatedAt) } : {}),
      ...(pendingReadStreams.has(conversation.id) ? { unreadCount: 0, mentionCount: 0 } : {}),
    };
  });
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 408 || error.status === 425 || error.status === 429;
}

function updateOptimisticReaction(reactions: Message["reactions"], emoji: string, active: boolean, userId: string | undefined): Message["reactions"] {
  const existing = reactions.find((reaction) => reaction.emoji === emoji);
  if (active) {
    if (!existing) return [...reactions, { emoji, count: 1, reacted: true, userIds: userId ? [userId] : [] }];
    return reactions.map((reaction) => reaction.emoji === emoji ? {
      ...reaction,
      count: reaction.reacted ? reaction.count : reaction.count + 1,
      reacted: true,
      userIds: userId && !reaction.userIds.includes(userId) ? [...reaction.userIds, userId] : reaction.userIds,
    } : reaction);
  }
  if (!existing) return reactions;
  if (existing.count <= 1) return reactions.filter((reaction) => reaction.emoji !== emoji);
  return reactions.map((reaction) => reaction.emoji === emoji ? {
    ...reaction,
    count: reaction.reacted ? Math.max(0, reaction.count - 1) : reaction.count,
    reacted: false,
    userIds: userId ? reaction.userIds.filter((id) => id !== userId) : reaction.userIds,
  } : reaction);
}

function hasActiveReaction(message: Message, emoji: string): boolean {
  return message.reactions.some((reaction) => reaction.emoji === emoji && reaction.reacted);
}

function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  return boundedMessageWindow(mergeUnboundedMessages(existing, incoming));
}

function findMessage(messagesByStream: Record<string, Message[]>, messageId: string): Message | undefined {
  for (const messages of Object.values(messagesByStream)) {
    const message = messages.find((candidate) => candidate.id === messageId);
    if (message) return message;
  }
  return undefined;
}

function mapIfChanged<T>(items: T[], transform: (item: T, index: number) => T): T[] {
  let next: T[] | null = null;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const transformed = transform(item, index);
    if (!next && transformed !== item) next = items.slice(0, index);
    next?.push(transformed);
  }
  return next ?? items;
}
