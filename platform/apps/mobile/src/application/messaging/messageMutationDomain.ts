import type { Message } from "@snezhok/contracts";

import { ApiError } from "../../lib/apiError";
import { applyConversationPreview } from "../../store/conversationPreview";
import { markMessageDeleted } from "../../domains/messaging/messageReconciliation";
import { drainOutbox, enqueueOutbox, MutationRetryScheduler, retryAvailableAt } from "../../store/outboxReliability";
import type { AppState, AppStoreGet, AppStoreSet } from "../../store/appState";
import type { MessageCreateInput, OutboxEntry } from "../../types";
import type { PersistenceRequest } from "../../infrastructure/persistence/appPersistenceCoordinator";
import { dispatchOutboxEntry, type OutboxDispatchResult, type OutboxTransport } from "./outboxDispatcher";
import { mergeMessageWindow } from "../../domains/messaging/messageWindow";

interface Dependencies<Guard> {
  set: AppStoreSet;
  get: AppStoreGet;
  persist: (request: PersistenceRequest) => void;
  persistNow: (request: PersistenceRequest) => Promise<void>;
  captureGuard: () => Guard;
  guardIsCurrent: (guard: Guard) => boolean;
  createId: () => string;
  transport: OutboxTransport;
}

type MessageMutationActions = Pick<AppState,
  "sendMessage" | "forwardMessage" | "editMessage" | "toggleReaction" |
  "deleteMessage" | "deleteMessages" | "setMessagePinned" | "retryOutbox">;

export interface MessageMutationDomain {
  actions: MessageMutationActions;
  scheduleDrain: () => void;
  reset: () => void;
}

/** Durable optimistic mutations. Network dispatch and UI projection are kept separate. */
export function createMessageMutationDomain<Guard>({ set, get, persist, persistNow, captureGuard, guardIsCurrent, createId, transport }: Dependencies<Guard>): MessageMutationDomain {
  const reactionSyncQueues = new Map<string, Promise<void>>();
  const retryScheduler = new MutationRetryScheduler();
  let outboxRetry: Promise<void> | null = null;

  const deleteMessages = async (messages: Message[], scope: "me" | "everyone") => {
    const snapshot = [...new Map(messages.map((message) => [message.id, message])).values()];
    if (!snapshot.length) return;
    const guard = captureGuard();
    const deletedAt = Date.now();
    const entries = snapshot.map((message): Extract<OutboxEntry, { kind: "delete" }> => ({
      kind: "delete",
      id: createId(),
      streamId: message.streamId,
      messageId: message.id,
      scope,
      previous: message,
      queuedAt: deletedAt,
      attempts: 0,
    }));
    const affectedStreams = [...new Set(snapshot.map((message) => message.streamId))];
    const idsByStream = new Map<string, Set<string>>();
    for (const message of snapshot) {
      const ids = idsByStream.get(message.streamId) ?? new Set<string>();
      ids.add(message.id);
      idsByStream.set(message.streamId, ids);
    }

    // One projection update removes the entire selection in the same frame.
    // Network acknowledgements may arrive individually, but the timeline never
    // animates a batch away message by message.
    set((state) => {
      const nextMessages = { ...state.messages };
      for (const streamId of affectedStreams) {
        const ids = idsByStream.get(streamId)!;
        nextMessages[streamId] = scope === "me"
          ? (state.messages[streamId] ?? []).filter((message) => !ids.has(message.id))
          : [...ids].reduce((current, id) => markMessageDeleted(current, id, deletedAt, true), state.messages[streamId] ?? []);
      }
      return {
        messages: nextMessages,
        outbox: entries.reduce((outbox, entry) => enqueueOutbox(outbox, entry), state.outbox),
      };
    });
    await persistNow({
      outbox: true,
      streamIds: affectedStreams,
      ...(scope === "me" ? { removedMessages: snapshot.map((message) => ({ streamId: message.streamId, messageId: message.id })) } : {}),
    });
    if (!guardIsCurrent(guard) || !get().online) return;

    const outcomes = await Promise.all(snapshot.map(async (message, index) => {
      const entry = entries[index]!;
      try {
        const saved = scope === "me" ? null : await transport.deleteMessage(message.id);
        if (scope === "me") await transport.hideMessage(message.id);
        return { entry, message, saved, error: null as unknown };
      } catch (error) {
        return { entry, message, saved: null, error };
      }
    }));
    if (!guardIsCurrent(guard)) return;

    let permanentFailure: unknown = null;
    set((state) => {
      let nextMessages = state.messages;
      let conversations = state.conversations;
      let outbox = state.outbox;
      for (const outcome of outcomes) {
        if (!outcome.error) {
          outbox = outbox.filter((item) => item.id !== outcome.entry.id);
          if (outcome.saved) {
            conversations = applyConversationPreview(conversations, outcome.saved);
            nextMessages = { ...nextMessages, [outcome.message.streamId]: mergeMessageWindow(nextMessages[outcome.message.streamId] ?? [], [outcome.saved]) };
          }
          continue;
        }
        if (isRetryable(outcome.error)) {
          outbox = outbox.map((item) => item.id === outcome.entry.id ? { ...item, attempts: 1 } : item);
          continue;
        }
        permanentFailure ??= outcome.error;
        outbox = outbox.filter((item) => item.id !== outcome.entry.id);
        nextMessages = { ...nextMessages, [outcome.message.streamId]: mergeMessageWindow(nextMessages[outcome.message.streamId] ?? [], [outcome.message]) };
      }
      return { conversations, messages: nextMessages, outbox };
    });
    persist({ bootstrap: true, outbox: true, streamIds: affectedStreams });
    void get().refreshBootstrap({ force: true, silent: true });
    if (permanentFailure) throw permanentFailure;
  };

  const actions: MessageMutationActions = {
    sendMessage: async (streamId, partial, optimisticAttachments = []) => {
      const me = get().me;
      if (!me) throw new Error("No active session");
      const guard = captureGuard();
      const clientId = createId();
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
      const entry: OutboxEntry = { kind: "message", id: clientId, streamId, input, queuedAt: Date.now(), attempts: 0 };
      set((state) => ({
        conversations: applyConversationPreview(state.conversations, optimistic),
        messages: { ...state.messages, [streamId]: mergeMessageWindow(state.messages[streamId] ?? [], [optimistic]) },
        outbox: enqueueOutbox(state.outbox, entry),
      }));
      await persistNow({ bootstrap: true, outbox: true, streamIds: [streamId] });
      if (!guardIsCurrent(guard) || !get().online) return;
      try {
        const saved = await transport.createMessage(streamId, input);
        if (!guardIsCurrent(guard)) return;
        set((state) => ({
          conversations: applyConversationPreview(state.conversations, saved),
          outbox: state.outbox.filter((item) => item.id !== clientId),
          messages: { ...state.messages, [streamId]: mergeMessageWindow(state.messages[streamId] ?? [], [saved]) },
        }));
      } catch (error) {
        if (!guardIsCurrent(guard)) return;
        const retryable = isRetryable(error);
        set((state) => ({
          outbox: retryable ? state.outbox.map((item) => item.id === clientId ? { ...item, attempts: 1 } : item) : state.outbox.filter((item) => item.id !== clientId),
          messages: { ...state.messages, [streamId]: (state.messages[streamId] ?? []).map((message) => message.id === clientId ? { ...message, pending: false, failed: true } : message) },
        }));
      }
      // The optimistic write is durable before the request. Once the server has
      // acknowledged (or definitively rejected) it, persist that terminal state
      // before resolving as well. A process death immediately after Send must
      // never resurrect a stale pending bubble or an already-delivered outbox job.
      if (guardIsCurrent(guard)) await persistNow({ bootstrap: true, outbox: true, streamIds: [streamId] });
    },

    forwardMessage: async (messageId, targetStreamId) => {
      const me = get().me;
      const source = findMessage(get().messages, messageId);
      if (!me || !source) throw new Error("Message is no longer available");
      const guard = captureGuard();
      const clientId = createId();
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
        reactions: [], createdAt: Date.now(), editedAt: null, deletedAt: null, pinnedAt: null,
        silent: false, readByOthers: false, pending: true, failed: false,
      };
      const entry: OutboxEntry = { kind: "forward", id: clientId, streamId: targetStreamId, sourceMessageId: messageId, clientId, queuedAt: Date.now(), attempts: 0 };
      set((state) => ({
        conversations: applyConversationPreview(state.conversations, optimistic),
        messages: { ...state.messages, [targetStreamId]: mergeMessageWindow(state.messages[targetStreamId] ?? [], [optimistic]) },
        outbox: enqueueOutbox(state.outbox, entry),
      }));
      await persistNow({ bootstrap: true, outbox: true, streamIds: [targetStreamId] });
      if (!guardIsCurrent(guard) || !get().online) return optimistic;
      let saved: Message;
      try {
        saved = await transport.forwardMessage(messageId, targetStreamId, clientId);
      } catch (error) {
        if (!guardIsCurrent(guard)) return optimistic;
        const retryable = isRetryable(error);
        set((state) => ({
          outbox: retryable ? state.outbox.map((item) => item.id === entry.id ? { ...item, attempts: 1 } : item) : state.outbox.filter((item) => item.id !== entry.id),
          messages: { ...state.messages, [targetStreamId]: (state.messages[targetStreamId] ?? []).map((message) => message.id === clientId ? { ...message, pending: false, failed: true } : message) },
        }));
        persist({ outbox: true, streamIds: [targetStreamId] });
        if (!retryable) throw error;
        return optimistic;
      }
      if (!guardIsCurrent(guard)) return optimistic;
      set((state) => ({
        conversations: applyConversationPreview(state.conversations, saved),
        outbox: state.outbox.filter((item) => item.id !== entry.id),
        messages: { ...state.messages, [targetStreamId]: mergeMessageWindow(state.messages[targetStreamId] ?? [], [saved]) },
      }));
      persist({ bootstrap: true, outbox: true, streamIds: [targetStreamId] });
      return saved;
    },

    editMessage: async (message, text) => {
      const value = text.trim();
      if (!value || value === message.text) return;
      const guard = captureGuard();
      const optimistic: Message = { ...message, text: value, editedAt: Date.now() };
      const entry: OutboxEntry = { kind: "edit", id: createId(), streamId: message.streamId, messageId: message.id, text: value, previous: message, queuedAt: Date.now(), attempts: 0 };
      set((state) => ({
        conversations: applyConversationPreview(state.conversations, optimistic),
        messages: { ...state.messages, [message.streamId]: mergeMessageWindow(state.messages[message.streamId] ?? [], [optimistic]) },
        outbox: enqueueOutbox(state.outbox, entry),
      }));
      await persistNow({ bootstrap: true, outbox: true, streamIds: [message.streamId] });
      if (!guardIsCurrent(guard) || !get().online) return;
      try {
        const saved = await transport.editMessage(message.id, value);
        if (!guardIsCurrent(guard)) return;
        set((state) => {
          const current = (state.messages[message.streamId] ?? []).find((item) => item.id === message.id);
          if (!current || current.text !== value || current.deletedAt) return { outbox: state.outbox.filter((item) => item.id !== entry.id) };
          return {
            conversations: applyConversationPreview(state.conversations, saved),
            messages: { ...state.messages, [message.streamId]: mergeMessageWindow(state.messages[message.streamId] ?? [], [saved]) },
            outbox: state.outbox.filter((item) => item.id !== entry.id),
          };
        });
      } catch (error) {
        if (!guardIsCurrent(guard)) return;
        if (isRetryable(error)) set((state) => ({ outbox: state.outbox.map((item) => item.id === entry.id ? { ...item, attempts: 1 } : item) }));
        else {
          set((state) => ({
            conversations: applyConversationPreview(state.conversations, message),
            messages: { ...state.messages, [message.streamId]: mergeMessageWindow(state.messages[message.streamId] ?? [], [message]) },
            outbox: state.outbox.filter((item) => item.id !== entry.id),
          }));
          throw error;
        }
      } finally {
        if (guardIsCurrent(guard)) persist({ bootstrap: true, outbox: true, streamIds: [message.streamId] });
      }
    },

    toggleReaction: async (message, emoji) => {
      const guard = captureGuard();
      const current = (get().messages[message.streamId] ?? []).find((candidate) => candidate.id === message.id) ?? message;
      const active = !hasActiveReaction(current, emoji);
      const optimistic = { ...current, reactions: updateOptimisticReaction(current.reactions, emoji, active, get().me?.id) };
      const entry: OutboxEntry = { kind: "reaction", id: createId(), streamId: current.streamId, messageId: current.id, emoji, active, previous: current, queuedAt: Date.now(), attempts: 0 };
      set((state) => ({ messages: { ...state.messages, [current.streamId]: mergeMessageWindow(state.messages[current.streamId] ?? [], [optimistic]) }, outbox: enqueueOutbox(state.outbox, entry) }));
      await persistNow({ outbox: true, streamIds: [current.streamId] });
      if (!guardIsCurrent(guard) || !get().online) return;
      const queueKey = `${current.id}\u0000${emoji}`;
      const operation = (reactionSyncQueues.get(queueKey) ?? Promise.resolve()).then(async () => {
        if (!guardIsCurrent(guard)) return;
        try {
          const saved = await transport.setReaction(current.id, emoji, active);
          if (!guardIsCurrent(guard)) return;
          set((state) => {
            const live = (state.messages[current.streamId] ?? []).find((candidate) => candidate.id === current.id);
            if (!live || hasActiveReaction(live, emoji) !== active) return { outbox: state.outbox.filter((item) => item.id !== entry.id) };
            return { messages: { ...state.messages, [current.streamId]: mergeMessageWindow(state.messages[current.streamId] ?? [], [saved]) }, outbox: state.outbox.filter((item) => item.id !== entry.id) };
          });
        } catch (error) {
          if (!guardIsCurrent(guard)) return;
          if (isRetryable(error)) set((state) => ({ outbox: state.outbox.map((item) => item.id === entry.id ? { ...item, attempts: 1 } : item) }));
          else {
            set((state) => {
              const live = (state.messages[current.streamId] ?? []).find((candidate) => candidate.id === current.id);
              if (!live || hasActiveReaction(live, emoji) !== active) return { outbox: state.outbox.filter((item) => item.id !== entry.id) };
              return { messages: { ...state.messages, [current.streamId]: mergeMessageWindow(state.messages[current.streamId] ?? [], [current]) }, outbox: state.outbox.filter((item) => item.id !== entry.id) };
            });
            throw error;
          }
        } finally {
          if (guardIsCurrent(guard)) persist({ outbox: true, streamIds: [current.streamId] });
        }
      });
      reactionSyncQueues.set(queueKey, operation.catch(() => undefined));
      await operation;
    },

    deleteMessage: async (message, scope) => deleteMessages([message], scope),
    deleteMessages,

    setMessagePinned: async (message, pinned) => {
      const guard = captureGuard();
      const optimistic = { ...message, pinnedAt: pinned ? Date.now() : null };
      const entry: OutboxEntry = { kind: "pin", id: createId(), streamId: message.streamId, messageId: message.id, pinned, previous: message, queuedAt: Date.now(), attempts: 0 };
      set((state) => ({ messages: { ...state.messages, [message.streamId]: mergeMessageWindow(state.messages[message.streamId] ?? [], [optimistic]) }, outbox: enqueueOutbox(state.outbox, entry) }));
      await persistNow({ outbox: true, streamIds: [message.streamId] });
      if (!guardIsCurrent(guard) || !get().online) return;
      try {
        const saved = await transport.setMessagePinned(message.id, pinned);
        if (!guardIsCurrent(guard)) return;
        set((state) => {
          const current = (state.messages[message.streamId] ?? []).find((item) => item.id === message.id);
          if (!current || Boolean(current.pinnedAt) !== pinned || current.deletedAt) return { outbox: state.outbox.filter((item) => item.id !== entry.id) };
          return { messages: { ...state.messages, [message.streamId]: mergeMessageWindow(state.messages[message.streamId] ?? [], [saved]) }, outbox: state.outbox.filter((item) => item.id !== entry.id) };
        });
      } catch (error) {
        if (!guardIsCurrent(guard)) return;
        if (isRetryable(error)) set((state) => ({ outbox: state.outbox.map((item) => item.id === entry.id ? { ...item, attempts: 1 } : item) }));
        else {
          set((state) => ({ messages: { ...state.messages, [message.streamId]: mergeMessageWindow(state.messages[message.streamId] ?? [], [message]) }, outbox: state.outbox.filter((item) => item.id !== entry.id) }));
          throw error;
        }
      } finally {
        if (guardIsCurrent(guard)) persist({ outbox: true, streamIds: [message.streamId] });
      }
    },

    retryOutbox: async () => {
      if (!get().online || get().outbox.length === 0) return;
      if (outboxRetry) return outboxRetry;
      const guard = captureGuard();
      outboxRetry = (async () => {
        const snapshot = [...get().outbox];
        const acknowledgedIds = new Map<string, string>();
        await drainOutbox(snapshot, async (entry) => {
          if (!guardIsCurrent(guard)) throw new StaleAccountOperationError();
          try {
            const result = await dispatchOutboxEntry(transport, entry, acknowledgedIds);
            if (!guardIsCurrent(guard)) throw new StaleAccountOperationError();
            if (result.kind === "created") {
              acknowledgedIds.set(result.entryId, result.message.id);
              acknowledgedIds.set(result.clientId, result.message.id);
            }
            set((state) => applyOutboxDispatchResult(state, result));
          } catch (error) {
            if (error instanceof StaleAccountOperationError || isRetryable(error)) throw error;
            set((state) => restoreRejectedOutbox(state, entry));
          }
        }, (entry) => {
          if (guardIsCurrent(guard)) set((state) => ({ outbox: state.outbox.filter((item) => item.id !== entry.id) }));
        }, (entry) => {
          if (guardIsCurrent(guard)) set((state) => ({ outbox: state.outbox.map((item) => {
            if (item.id !== entry.id) return item;
            const attempts = item.attempts + 1;
            return { ...item, attempts, availableAt: retryAvailableAt(attempts) };
          }) }));
        }, { concurrency: 3 });
        if (guardIsCurrent(guard)) await persistNow({ bootstrap: true, outbox: true, streamIds: new Set(snapshot.map((entry) => entry.streamId)) });
      })().finally(() => { outboxRetry = null; });
      return outboxRetry;
    },
  };

  const scheduleDrain = () => {
    const state = get();
    if (state.phase !== "ready" || !state.me || !state.online || state.outbox.length === 0) {
      retryScheduler.cancel();
      return;
    }
    const availableAt = Math.min(...state.outbox.map((entry) => entry.availableAt ?? Date.now()));
    retryScheduler.schedule(availableAt, () => {
      const current = get();
      if (current.phase === "ready" && current.online) void current.retryOutbox().catch(() => undefined);
    });
  };

  return {
    actions,
    scheduleDrain,
    reset: () => {
      retryScheduler.cancel();
      reactionSyncQueues.clear();
      outboxRetry = null;
    },
  };
}

function applyOutboxDispatchResult(state: AppState, result: OutboxDispatchResult): AppState | Partial<AppState> {
  if (result.kind === "created" || result.kind === "deleted") {
    const message = result.message;
    return { conversations: applyConversationPreview(state.conversations, message), messages: { ...state.messages, [message.streamId]: mergeMessageWindow(state.messages[message.streamId] ?? [], [message]) } };
  }
  if (result.kind === "read") return {
    conversations: state.conversations.map((conversation) => conversation.id === result.streamId ? { ...conversation, unreadCount: 0, mentionCount: 0 } : conversation),
    channels: state.channels.map((channel) => channel.id === result.streamId ? { ...channel, unreadCount: 0, mentionCount: 0 } : channel),
  };
  if (result.kind === "hidden") return { messages: { ...state.messages, [result.streamId]: (state.messages[result.streamId] ?? []).filter((message) => message.id !== result.messageId) } };
  const live = (state.messages[result.streamId] ?? []).find((message) => message.id === result.messageId);
  const stillCurrent = result.kind === "edited" ? live?.text === result.expectedText
    : result.kind === "pinned" ? Boolean(live?.pinnedAt) === result.expectedPinned
      : Boolean(live && hasActiveReaction(live, result.emoji) === result.expectedActive);
  if (!stillCurrent || live?.deletedAt) return state;
  return {
    ...(result.kind === "edited" ? { conversations: applyConversationPreview(state.conversations, result.message) } : {}),
    messages: { ...state.messages, [result.streamId]: mergeMessageWindow(state.messages[result.streamId] ?? [], [result.message]) },
  };
}

function restoreRejectedOutbox(state: AppState, entry: OutboxEntry): Partial<AppState> {
  if (entry.kind === "message" || entry.kind === "forward") return { messages: { ...state.messages, [entry.streamId]: (state.messages[entry.streamId] ?? []).map((message) => message.id === entry.id ? { ...message, pending: false, failed: true } : message) } };
  if (entry.kind === "read") return {};
  const live = (state.messages[entry.streamId] ?? []).find((message) => message.id === entry.messageId);
  const stillCurrent = entry.kind === "edit" ? live?.text === entry.text
    : entry.kind === "pin" ? Boolean(live?.pinnedAt) === entry.pinned
      : entry.kind === "reaction" ? Boolean(live && hasActiveReaction(live, entry.emoji) === entry.active)
        : Boolean(live?.deletedAt && live.pending);
  if (!stillCurrent) return {};
  return {
    conversations: entry.kind === "edit" ? applyConversationPreview(state.conversations, entry.previous) : state.conversations,
    messages: { ...state.messages, [entry.streamId]: mergeMessageWindow(state.messages[entry.streamId] ?? [], [entry.previous]) },
  };
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 408 || error.status === 425 || error.status === 429;
}

function updateOptimisticReaction(reactions: Message["reactions"], emoji: string, active: boolean, userId: string | undefined): Message["reactions"] {
  const existing = reactions.find((reaction) => reaction.emoji === emoji);
  if (active) {
    if (!existing) return [...reactions, { emoji, count: 1, reacted: true, userIds: userId ? [userId] : [] }];
    return reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, count: reaction.reacted ? reaction.count : reaction.count + 1, reacted: true, userIds: userId && !reaction.userIds.includes(userId) ? [...reaction.userIds, userId] : reaction.userIds } : reaction);
  }
  if (!existing) return reactions;
  if (existing.count <= 1) return reactions.filter((reaction) => reaction.emoji !== emoji);
  return reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, count: reaction.reacted ? Math.max(0, reaction.count - 1) : reaction.count, reacted: false, userIds: userId ? reaction.userIds.filter((id) => id !== userId) : reaction.userIds } : reaction);
}

function hasActiveReaction(message: Message, emoji: string): boolean {
  return message.reactions.some((reaction) => reaction.emoji === emoji && reaction.reacted);
}

function findMessage(messagesByStream: Record<string, Message[]>, messageId: string): Message | undefined {
  for (const messages of Object.values(messagesByStream)) {
    const message = messages.find((candidate) => candidate.id === messageId);
    if (message) return message;
  }
  return undefined;
}

class StaleAccountOperationError extends Error {
  constructor() {
    super("Account changed while the operation was in progress");
    this.name = "StaleAccountOperationError";
  }
}
