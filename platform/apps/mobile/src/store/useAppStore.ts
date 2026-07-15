import * as Crypto from "expo-crypto";
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

import { api } from "../lib/api";
import { messagesForCache } from "../lib/cachePolicy";
import { clearLocalData, readCache, readOutbox, writeCache, writeOutbox } from "../lib/offlineRepository";
import { clearSession, readSession, writeSession } from "../lib/secureSession";
import type { MessageCreateInput, OutboxEntry, SettingsPatch, UploadInput } from "../types";
import { applyConversationPreview } from "./conversationPreview";
import { upsertConversation } from "./conversationIdentity";
import { markMessageDeleted, mergeMessages, reconcilePinnedMessages } from "./messageReconciliation";

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
  outbox: OutboxEntry[];
  uploadProgress: number | null;
  initialize: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (input: { email: string; username: string; password: string }) => Promise<void>;
  clearError: () => void;
  signOut: () => Promise<void>;
  setOnline: (online: boolean) => void;
  refreshBootstrap: (options?: { force?: boolean; silent?: boolean }) => Promise<void>;
  loadMessages: (streamId: string, before?: number) => Promise<void>;
  markStreamRead: (streamId: string, sequence: number) => Promise<void>;
  loadPinnedMessages: (streamId: string) => Promise<void>;
  uploadAttachment: (input: UploadInput) => Promise<Attachment>;
  sendMessage: (streamId: string, input: Omit<MessageCreateInput, "clientId">) => Promise<void>;
  forwardMessage: (messageId: string, targetStreamId: string) => Promise<Message>;
  toggleReaction: (message: Message, emoji: string) => Promise<void>;
  deleteMessage: (message: Message, scope: "me" | "everyone") => Promise<void>;
  setMessagePinned: (message: Message, pinned: boolean) => Promise<void>;
  retryOutbox: () => Promise<void>;
  applyMessage: (message: Message) => void;
  applyMessageDeleted: (payload: { id: string; streamId: string; deletedAt: number }) => void;
  applyConversation: (conversation: ConversationSummary) => void;
  deleteConversation: (conversationId: string) => Promise<void>;
  removeConversation: (conversationId: string) => void;
  applyPresence: (userId: string, presence: Presence, lastSeenAt: number) => void;
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

function persistState(): Promise<void> {
  const state = useAppStore.getState();
  const snapshot = { bootstrap: toBootstrap(state), messages: messagesForCache(state.messages), cachedAt: Date.now() };
  const outbox = state.outbox;
  persistenceQueue = persistenceQueue.catch(() => undefined).then(async () => {
    await Promise.all([writeCache(snapshot), writeOutbox(outbox)]);
  });
  return persistenceQueue;
}

let bootstrapRefresh: Promise<void> | null = null;
let lastBootstrapCompletedAt = 0;
let persistenceTimer: ReturnType<typeof setTimeout> | null = null;
const messageLoads = new Map<string, Promise<void>>();
const latestMessageLoads = new Map<string, number>();

function schedulePersistence(): void {
  if (persistenceTimer) clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    persistenceTimer = null;
    void persistState().catch((error) => console.warn("Could not persist offline cache", error));
  }, 250);
}

function cancelScheduledPersistence(): void {
  if (persistenceTimer) clearTimeout(persistenceTimer);
  persistenceTimer = null;
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
  outbox: [],
  uploadProgress: null,

  initialize: async () => {
    const [session, cache, outbox] = await Promise.all([readSession(), readCache(), readOutbox()]);
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
      outbox,
      eventCursor: cached?.eventCursor ?? 0,
    });
    try {
      await get().refreshBootstrap({ force: true });
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
    } catch (error) {
      await clearSession();
      set({ phase: "signed-out", error: error instanceof Error ? error.message : "Registration failed" });
      throw error;
    }
  },

  clearError: () => set({ error: null }),

  signOut: async () => {
    cancelScheduledPersistence();
    lastBootstrapCompletedAt = 0;
    latestMessageLoads.clear();
    await persistenceQueue.catch(() => undefined);
    await Promise.all([clearSession(), clearLocalData()]);
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
      outbox: [],
      eventCursor: 0,
      uploadProgress: null,
    });
  },

  setOnline: (online) => {
    set({ online });
    if (online) {
      void get().refreshBootstrap({ force: true, silent: true });
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
        set({
          phase: "ready",
          error: null,
          syncing: false,
          me: payload.me,
          conversations: payload.conversations,
          servers: payload.servers,
          categories: payload.categories,
          channels: payload.channels,
          friends: payload.friends,
          settings: payload.settings,
          eventCursor: payload.eventCursor,
        });
        lastBootstrapCompletedAt = Date.now();
        await persistState();
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

  loadMessages: (streamId, before) => {
    if (!get().online) return Promise.resolve();
    const key = `${streamId}:${before ?? "latest"}`;
    const active = messageLoads.get(key);
    if (active) return active;
    if (before === undefined && (get().messages[streamId]?.length ?? 0) > 0 && Date.now() - (latestMessageLoads.get(streamId) ?? 0) < 15_000) return Promise.resolve();
    const loading = (async () => {
      const page = await api.messages(streamId, before);
      set((state) => ({
        messages: {
          ...state.messages,
          [streamId]: mergeMessages(state.messages[streamId] ?? [], page.items),
        },
      }));
      if (before === undefined) latestMessageLoads.set(streamId, Date.now());
      await persistState();
    })().finally(() => messageLoads.delete(key));
    messageLoads.set(key, loading);
    return loading;
  },

  markStreamRead: async (streamId, sequence) => {
    if (sequence < 0) return;
    // Clear the badge immediately. The server write remains idempotent and is
    // retried whenever the focused chat receives another message.
    set((state) => ({
      conversations: state.conversations.map((conversation) => conversation.id === streamId
        ? { ...conversation, unreadCount: 0, mentionCount: 0 }
        : conversation),
      channels: state.channels.map((channel) => channel.id === streamId
        ? { ...channel, unreadCount: 0, mentionCount: 0 }
        : channel),
    }));
    await persistState();
    if (!get().online) return;
    await api.markRead(streamId, sequence);
  },

  loadPinnedMessages: async (streamId) => {
    if (!get().online) return;
    const pinned = await api.pinnedMessages(streamId);
    set((state) => ({
      messages: { ...state.messages, [streamId]: reconcilePinnedMessages(state.messages[streamId] ?? [], pinned) },
    }));
    await persistState();
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

  sendMessage: async (streamId, partial) => {
    const me = get().me;
    if (!me) throw new Error("No active session");
    const clientId = Crypto.randomUUID();
    const input: MessageCreateInput = { ...partial, clientId };
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
      attachments: [],
      reactions: [],
      createdAt: Date.now(),
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      pending: true,
      failed: false,
    };
    set((state) => ({
      conversations: applyConversationPreview(state.conversations, optimistic),
      messages: { ...state.messages, [streamId]: mergeMessages(state.messages[streamId] ?? [], [optimistic]) },
    }));

    if (!get().online) {
      const entry: OutboxEntry = { id: clientId, streamId, input, queuedAt: Date.now(), attempts: 0 };
      set((state) => ({ outbox: [...state.outbox, entry] }));
      await persistState();
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
    } catch {
      const entry: OutboxEntry = { id: clientId, streamId, input, queuedAt: Date.now(), attempts: 1 };
      set((state) => ({
        outbox: [...state.outbox.filter((item) => item.id !== clientId), entry],
        messages: {
          ...state.messages,
          [streamId]: (state.messages[streamId] ?? []).map((message) =>
            message.id === clientId ? { ...message, pending: false, failed: true } : message,
          ),
        },
      }));
    }
    await persistState();
  },

  forwardMessage: async (messageId, targetStreamId) => {
    if (!get().online) throw new Error("Forwarding requires a connection");
    const saved = await api.forwardMessage(messageId, targetStreamId, Crypto.randomUUID());
    set((state) => ({
      conversations: applyConversationPreview(state.conversations, saved),
      messages: { ...state.messages, [targetStreamId]: mergeMessages(state.messages[targetStreamId] ?? [], [saved]) },
    }));
    await persistState();
    return saved;
  },

  toggleReaction: async (message, emoji) => {
    if (!get().online) throw new Error("Reactions require a connection");
    const active = !message.reactions.some((reaction) => reaction.emoji === emoji && reaction.reacted);
    const saved = await api.setReaction(message.id, emoji, active);
    set((state) => ({ messages: { ...state.messages, [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [saved]) } }));
    await persistState();
  },

  deleteMessage: async (message, scope) => {
    if (!get().online) throw new Error("Deleting messages requires a connection");
    if (scope === "me") {
      await api.hideMessage(message.id);
      set((state) => ({
        messages: {
          ...state.messages,
          [message.streamId]: (state.messages[message.streamId] ?? []).filter((item) => item.id !== message.id),
        },
      }));
      await persistState();
      await get().refreshBootstrap();
      return;
    }
    const saved = await api.deleteMessage(message.id);
    set((state) => ({
      conversations: applyConversationPreview(state.conversations, saved),
      messages: { ...state.messages, [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [saved]) },
    }));
    await persistState();
    // The server may reveal the previous message as the new conversation
    // preview after deleting the latest one.
    await get().refreshBootstrap();
  },

  setMessagePinned: async (message, pinned) => {
    if (!get().online) throw new Error("Pinning messages requires a connection");
    const saved = await api.setMessagePinned(message.id, pinned);
    set((state) => ({
      messages: { ...state.messages, [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [saved]) },
    }));
    await persistState();
  },

  retryOutbox: async () => {
    if (!get().online || get().outbox.length === 0) return;
    for (const entry of [...get().outbox]) {
      try {
        const saved = await api.createMessage(entry.streamId, entry.input);
        set((state) => ({
          outbox: state.outbox.filter((item) => item.id !== entry.id),
          conversations: applyConversationPreview(state.conversations, saved),
          messages: {
            ...state.messages,
            [entry.streamId]: mergeMessages(state.messages[entry.streamId] ?? [], [saved]),
          },
        }));
      } catch {
        set((state) => ({
          outbox: state.outbox.map((item) =>
            item.id === entry.id ? { ...item, attempts: item.attempts + 1 } : item,
          ),
        }));
        break;
      }
    }
    await persistState();
  },

  applyMessage: (message) => {
    set((state) => ({
      conversations: applyConversationPreview(state.conversations, message),
      messages: {
        ...state.messages,
        [message.streamId]: mergeMessages(state.messages[message.streamId] ?? [], [message]),
      },
    }));
    latestMessageLoads.set(message.streamId, Date.now());
    schedulePersistence();
  },

  applyMessageDeleted: ({ id, streamId, deletedAt }) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [streamId]: markMessageDeleted(state.messages[streamId] ?? [], id, deletedAt),
      },
    }));
    schedulePersistence();
    void get().refreshBootstrap({ force: true, silent: true });
  },

  applyConversation: (conversation) => {
    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    schedulePersistence();
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
    schedulePersistence();
  },

  applyPresence: (userId, presence, lastSeenAt) => {
    const updateUser = (user: UserSummary): UserSummary => {
      if (user.id !== userId || (user.presence === presence && user.lastSeenAt === lastSeenAt)) return user;
      return { ...user, presence, lastSeenAt };
    };
    set((state) => ({
      me: state.me ? updateUser(state.me) : null,
      conversations: state.conversations.map((conversation) => {
        const participants = conversation.participants.map(updateUser);
        return participants.some((participant, index) => participant !== conversation.participants[index]) ? { ...conversation, participants } : conversation;
      }),
      friends: state.friends.map((entry) => {
        const user = updateUser(entry.user);
        return user === entry.user ? entry : { ...entry, user };
      }),
      channels: state.channels.map((channel) => {
        const connectedMembers = channel.connectedMembers.map(updateUser);
        return connectedMembers.some((member, index) => member !== channel.connectedMembers[index]) ? { ...channel, connectedMembers } : channel;
      }),
    }));
  },

  updateSettings: async (patch) => {
    const previous = get().settings;
    const next = { ...previous, ...patch };
    set({ settings: next });
    await persistState();
    if (!get().online) return;
    try {
      const saved = await api.updateSettings(patch);
      set({ settings: saved });
      await persistState();
    } catch (error) {
      set({ settings: previous });
      throw error;
    }
  },

  setEventCursor: (cursor) => {
    set((state) => ({ eventCursor: Math.max(state.eventCursor, cursor) }));
    schedulePersistence();
  },
}));
