import type { OutboxEntry } from "../../types";
import { ApiError } from "../../lib/apiError";
import { boundedMessageWindow } from "../../domains/messaging/cachePolicy";
import { cachedHistoryCursor } from "../../lib/offlineCachePolicy";
import { mergeMessageWindow } from "../../domains/messaging/messageWindow";
import { mergeMessages, reconcilePinnedMessages } from "../../domains/messaging/messageReconciliation";
import { enqueueOutbox } from "../../store/outboxReliability";
import type { AppState, AppStoreGet, AppStoreSet } from "../../store/appState";
import type { PersistenceRequest } from "../../infrastructure/persistence/appPersistenceCoordinator";

interface Dependencies<Guard> {
  set: AppStoreSet;
  get: AppStoreGet;
  persist: (request: PersistenceRequest) => void;
  captureGuard: () => Guard;
  guardIsCurrent: (guard: Guard) => boolean;
  createId: () => string;
  now?: () => number;
  transport: Pick<typeof import("../../infrastructure/http/apiClient").api,
    "messages" | "messageContext" | "markRead" | "markUnread" | "pinnedMessages">;
  cache: {
    readPage: typeof import("../../lib/offlineRepository").readCachedMessagePage;
    readPages: typeof import("../../lib/offlineRepository").readCachedMessagePages;
  };
}

type MessageQueryActions = Pick<
  AppState,
  | "loadMessages"
  | "preloadCachedMessages"
  | "loadOlderMessages"
  | "loadMessageContext"
  | "markStreamRead"
  | "markStreamUnread"
  | "loadPinnedMessages"
>;

export interface MessageQueryDomain {
  actions: MessageQueryActions;
  markStreamLoaded: (streamId: string) => void;
  forgetStream: (streamId: string) => void;
  reset: () => void;
}

/**
 * Owns cache/network query de-duplication for message windows. The Zustand
 * store exposes the commands, but it no longer owns request registries or
 * cursor policy. That makes cache-first chat opening independently testable.
 */
export function createMessageQueryDomain<Guard>({
  set,
  get,
  persist,
  captureGuard,
  guardIsCurrent,
  createId,
  now = Date.now,
  transport,
  cache,
}: Dependencies<Guard>): MessageQueryDomain {
  const messageLoads = new Map<string, Promise<void>>();
  const latestMessageLoads = new Map<string, number>();
  const cachedMessagePreloads = new Map<string, Promise<void>>();
  const pinnedMessageLoads = new Map<string, Promise<void>>();
  const latestPinnedMessageLoads = new Map<string, number>();

  const actions: MessageQueryActions = {
    loadMessages: (streamId, before) => {
      const guard = captureGuard();
      const key = `${streamId}:${before ?? "latest"}`;
      const active = messageLoads.get(key);
      if (active) return active;
      if (before === undefined && (get().messages[streamId]?.length ?? 0) > 0 && now() - (latestMessageLoads.get(streamId) ?? 0) < 15_000) return Promise.resolve();
      const loading = (async () => {
        if (before === undefined && !(get().messages[streamId]?.length)) {
          const cached = await cache.readPage(streamId, before, 40).catch(() => []);
          if (cached.length && guardIsCurrent(guard)) {
            set((state) => ({
              messages: { ...state.messages, [streamId]: boundedMessageWindow(mergeMessageWindow(state.messages[streamId] ?? [], cached)) },
            }));
          }
        }
        if (!guardIsCurrent(guard) || !get().online) return;
        const page = await transport.messages(streamId, before);
        if (!guardIsCurrent(guard)) return;
        set((state) => ({
          messages: {
            ...state.messages,
            [streamId]: boundedMessageWindow(mergeMessages(state.messages[streamId] ?? [], page.items), 300, before === undefined ? "latest" : "older"),
          },
          messagePagination: {
            ...state.messagePagination,
            [streamId]: { nextCursor: page.nextCursor === null ? null : Number(page.nextCursor), initialized: true },
          },
        }));
        if (before === undefined) latestMessageLoads.set(streamId, now());
        persist({ streamIds: [streamId] });
      })().finally(() => messageLoads.delete(key));
      messageLoads.set(key, loading);
      return loading;
    },

    preloadCachedMessages: async (streamIds) => {
      const guard = captureGuard();
      const missing = [...new Set(streamIds)].filter((streamId) => !(get().messages[streamId]?.length));
      if (!missing.length) return;
      const waiting = missing.flatMap((streamId) => {
        const active = cachedMessagePreloads.get(streamId);
        return active ? [active] : [];
      });
      const cold = missing.filter((streamId) => !cachedMessagePreloads.has(streamId));
      if (cold.length) {
        const preload = (async () => {
          const cached = await cache.readPages(cold, 40).catch(() => ({}));
          if (!guardIsCurrent(guard) || Object.keys(cached).length === 0) return;
          set((state) => ({
            messages: Object.fromEntries([
              ...Object.entries(state.messages),
              ...Object.entries(cached).map(([streamId, items]) => [
                streamId,
                boundedMessageWindow(mergeMessageWindow(state.messages[streamId] ?? [], items)),
              ]),
            ]),
          }));
        })().finally(() => {
          for (const streamId of cold) {
            if (cachedMessagePreloads.get(streamId) === preload) cachedMessagePreloads.delete(streamId);
          }
        });
        for (const streamId of cold) cachedMessagePreloads.set(streamId, preload);
        waiting.push(preload);
      }
      await Promise.all(waiting);
    },

    loadOlderMessages: async (streamId) => {
      const guard = captureGuard();
      const current = get().messages[streamId] ?? [];
      const earliestSequence = cachedHistoryCursor(current);
      if (earliestSequence !== undefined) {
        const cached = await cache.readPage(streamId, earliestSequence, 60).catch(() => []);
        if (!guardIsCurrent(guard)) return;
        if (cached.length) {
          set((state) => ({
            messages: { ...state.messages, [streamId]: boundedMessageWindow(mergeMessages(state.messages[streamId] ?? [], cached), 300, "older") },
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
      const guard = captureGuard();
      if ((get().messages[streamId] ?? []).some((message) => message.id === messageId) || !get().online) return;
      const context = await transport.messageContext(messageId);
      if (!guardIsCurrent(guard)) return;
      if (context.streamId !== streamId) throw new Error("Reply target belongs to another chat");
      set((state) => ({ messages: { ...state.messages, [streamId]: boundedMessageWindow(mergeMessageWindow(state.messages[streamId] ?? [], context.items)) } }));
      persist({ streamIds: [streamId] });
    },

    markStreamRead: async (streamId, sequence) => {
      const guard = captureGuard();
      if (sequence < 0) return;
      const shouldPersist = get().conversations.some((conversation) => conversation.id === streamId && (conversation.unreadCount > 0 || conversation.mentionCount > 0))
        || get().channels.some((channel) => channel.id === streamId && (channel.unreadCount > 0 || channel.mentionCount > 0));
      if (shouldPersist) {
        set((state) => ({
          conversations: state.conversations.map((conversation) => conversation.id === streamId ? { ...conversation, unreadCount: 0, mentionCount: 0 } : conversation),
          channels: state.channels.map((channel) => channel.id === streamId ? { ...channel, unreadCount: 0, mentionCount: 0 } : channel),
        }));
        persist({ bootstrap: true });
      }
      const entry: OutboxEntry = { kind: "read", id: createId(), streamId, sequence, queuedAt: now(), attempts: 0 };
      set((state) => ({ outbox: enqueueOutbox(state.outbox, entry) }));
      persist({ outbox: true });
      if (!guardIsCurrent(guard) || !get().online) return;
      try {
        const acknowledged = await transport.markRead(streamId, sequence);
        if (!guardIsCurrent(guard)) return;
        set((state) => ({
          outbox: state.outbox.filter((item) => item.id !== entry.id),
          conversations: state.conversations.map((conversation) => conversation.id === streamId && acknowledged.sequence >= sequence ? { ...conversation, unreadCount: 0, mentionCount: 0 } : conversation),
          channels: state.channels.map((channel) => channel.id === streamId && acknowledged.sequence >= sequence ? { ...channel, unreadCount: 0, mentionCount: 0 } : channel),
        }));
        persist({ bootstrap: true, outbox: true });
      } catch (error) {
        if (!guardIsCurrent(guard)) return;
        if (!isRetryable(error)) {
          set((state) => ({ outbox: state.outbox.filter((item) => item.id !== entry.id) }));
          persist({ outbox: true });
        }
        throw error;
      }
    },

    markStreamUnread: async (streamId, sequence) => {
      const guard = captureGuard();
      const previousConversationCount = get().conversations.find((item) => item.id === streamId)?.unreadCount ?? 0;
      const previousChannelCount = get().channels.find((item) => item.id === streamId)?.unreadCount ?? 0;
      set((state) => ({
        conversations: state.conversations.map((conversation) => conversation.id === streamId ? { ...conversation, unreadCount: Math.max(1, conversation.unreadCount) } : conversation),
        channels: state.channels.map((channel) => channel.id === streamId ? { ...channel, unreadCount: Math.max(1, channel.unreadCount) } : channel),
      }));
      persist({ bootstrap: true });
      try {
        await transport.markUnread(streamId, sequence);
      } catch (error) {
        if (!guardIsCurrent(guard)) return;
        set((state) => ({
          conversations: state.conversations.map((conversation) => conversation.id === streamId && conversation.unreadCount === 1 ? { ...conversation, unreadCount: previousConversationCount } : conversation),
          channels: state.channels.map((channel) => channel.id === streamId && channel.unreadCount === 1 ? { ...channel, unreadCount: previousChannelCount } : channel),
        }));
        persist({ bootstrap: true });
        throw error;
      }
    },

    loadPinnedMessages: (streamId) => {
      if (!get().online) return Promise.resolve();
      const active = pinnedMessageLoads.get(streamId);
      if (active) return active;
      if (now() - (latestPinnedMessageLoads.get(streamId) ?? 0) < 30_000) return Promise.resolve();
      const guard = captureGuard();
      const loading = (async () => {
        const pinned = await transport.pinnedMessages(streamId);
        if (!guardIsCurrent(guard)) return;
        set((state) => ({ messages: { ...state.messages, [streamId]: boundedMessageWindow(reconcilePinnedMessages(state.messages[streamId] ?? [], pinned)) } }));
        latestPinnedMessageLoads.set(streamId, now());
        persist({ streamIds: [streamId] });
      })().finally(() => pinnedMessageLoads.delete(streamId));
      pinnedMessageLoads.set(streamId, loading);
      return loading;
    },
  };

  return {
    actions,
    markStreamLoaded: (streamId) => latestMessageLoads.set(streamId, now()),
    forgetStream: (streamId) => {
      latestMessageLoads.delete(streamId);
      latestPinnedMessageLoads.delete(streamId);
    },
    reset: () => {
      messageLoads.clear();
      latestMessageLoads.clear();
      cachedMessagePreloads.clear();
      pinnedMessageLoads.clear();
      latestPinnedMessageLoads.clear();
    },
  };
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 408 || error.status === 425 || error.status === 429;
}
