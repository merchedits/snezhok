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
import { clearLocalData, readCache, readOutbox, writeCache, writeOutbox } from "../lib/offlineRepository";
import { clearSession, readSession, writeSession } from "../lib/secureSession";
import type { MessageCreateInput, OutboxEntry, SettingsPatch, UploadInput } from "../types";
import { applyConversationPreview } from "./conversationPreview";
import { mergeMessages } from "./messageReconciliation";

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
  refreshBootstrap: () => Promise<void>;
  loadMessages: (streamId: string, before?: number) => Promise<void>;
  uploadAttachment: (input: UploadInput) => Promise<Attachment>;
  sendMessage: (streamId: string, input: Omit<MessageCreateInput, "clientId">) => Promise<void>;
  forwardMessage: (messageId: string, targetStreamId: string) => Promise<Message>;
  toggleReaction: (message: Message, emoji: string) => Promise<void>;
  retryOutbox: () => Promise<void>;
  applyMessage: (message: Message) => void;
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

async function persistState(): Promise<void> {
  const state = useAppStore.getState();
  await Promise.all([
    writeCache({ bootstrap: toBootstrap(state), messages: state.messages, cachedAt: Date.now() }),
    writeOutbox(state.outbox),
  ]);
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
      await get().refreshBootstrap();
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
      await get().refreshBootstrap();
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
      await get().refreshBootstrap();
    } catch (error) {
      await clearSession();
      set({ phase: "signed-out", error: error instanceof Error ? error.message : "Registration failed" });
      throw error;
    }
  },

  clearError: () => set({ error: null }),

  signOut: async () => {
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
      void get().refreshBootstrap();
      void get().retryOutbox();
    }
  },

  refreshBootstrap: async () => {
    if (!get().online) return;
    set({ syncing: true });
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
      await persistState();
    } catch (error) {
      set({ syncing: false });
      const session = await readSession();
      if (!session) set({ phase: "signed-out" });
      throw error;
    }
  },

  loadMessages: async (streamId, before) => {
    if (!get().online) return;
    const page = await api.messages(streamId, before);
    set((state) => ({
      messages: {
        ...state.messages,
        [streamId]: mergeMessages(state.messages[streamId] ?? [], page.items),
      },
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
    void persistState();
  },

  applyPresence: (userId, presence, lastSeenAt) => {
    const updateUser = (user: UserSummary): UserSummary => user.id === userId ? { ...user, presence, lastSeenAt } : user;
    set((state) => ({
      me: state.me ? updateUser(state.me) : null,
      conversations: state.conversations.map((conversation) => ({ ...conversation, participants: conversation.participants.map(updateUser) })),
      friends: state.friends.map((entry) => ({ ...entry, user: updateUser(entry.user) })),
      channels: state.channels.map((channel) => ({ ...channel, connectedMembers: channel.connectedMembers.map(updateUser) })),
    }));
    void persistState();
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

  setEventCursor: (cursor) => set((state) => ({ eventCursor: Math.max(state.eventCursor, cursor) })),
}));
