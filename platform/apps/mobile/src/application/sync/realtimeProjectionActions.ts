import type { AttachmentLifecycleUpdate, ConversationSummary, Message, Presence, UserSummary } from "@snezhok/contracts";

import { mapIfChanged } from "../../core/collections/mapIfChanged";
import { applyAttachmentLifecycleToMessages } from "../../repositories/attachments/attachmentProjection";
import { applyConversationPreview } from "../../store/conversationPreview";
import { upsertConversation } from "../../store/conversationIdentity";
import { markMessageDeleted } from "../../domains/messaging/messageReconciliation";
import type { AppState, AppStoreGet, AppStoreSet } from "../../store/appState";
import type { PersistenceRequest } from "../../infrastructure/persistence/appPersistenceCoordinator";
import { mergeMessageWindow } from "../../domains/messaging/messageWindow";

export interface RealtimeProjectionDependencies {
  set: AppStoreSet;
  get: AppStoreGet;
  persist: (request: PersistenceRequest) => void;
  markStreamLoaded: (streamId: string) => void;
  forgetStream: (streamId: string) => void;
}

export type RealtimeProjectionActions = Pick<AppState,
  "applyMessage" | "applyAttachmentLifecycle" | "applyMessageDeleted" | "applyReadReceipt" |
  "applyConversation" | "removeConversation" | "applyPresence">;

/** Narrow deterministic handlers shared by durable realtime and reconciliation. */
export function createRealtimeProjectionActions(dependencies: RealtimeProjectionDependencies): RealtimeProjectionActions {
  const { set, get, persist, markStreamLoaded, forgetStream } = dependencies;
  return {
    applyMessage: (message: Message, eventKind = "updated") => {
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
          messages: { ...state.messages, [message.streamId]: mergeMessageWindow(existing, [message]) },
          outbox: message.clientId ? state.outbox.filter((entry) => entry.id !== message.clientId) : state.outbox,
        };
      });
      markStreamLoaded(message.streamId);
      persist({ bootstrap: true, ...(message.clientId ? { outbox: true } : {}), streamIds: [message.streamId] });
    },

    applyAttachmentLifecycle: (update: AttachmentLifecycleUpdate) => {
      let changedStreamIds: string[] = [];
      set((state) => {
        const projection = applyAttachmentLifecycleToMessages(state.messages, update);
        changedStreamIds = projection.changedStreamIds;
        return projection.messages === state.messages ? state : { messages: projection.messages };
      });
      if (changedStreamIds.length) persist({ streamIds: changedStreamIds });
    },

    applyMessageDeleted: ({ id, streamId, deletedAt }) => {
      set((state) => ({
        messages: { ...state.messages, [streamId]: markMessageDeleted(state.messages[streamId] ?? [], id, deletedAt) },
      }));
      persist({ streamIds: [streamId] });
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
      if (changed) persist({ streamIds: [streamId] });
    },

    applyConversation: (conversation: ConversationSummary) => {
      set((state) => ({ conversations: upsertConversation(state.conversations, conversation) }));
      persist({ bootstrap: true });
    },

    removeConversation: (conversationId: string) => {
      set((state) => {
        const { [conversationId]: _removed, ...messages } = state.messages;
        return { conversations: state.conversations.filter((item) => item.id !== conversationId), messages };
      });
      forgetStream(conversationId);
      persist({ bootstrap: true, removedStreamIds: [conversationId] });
    },

    applyPresence: (userId: string, presence: Presence, lastSeenAt: number) => {
      const updateUser = (user: UserSummary): UserSummary => user.id !== userId || (user.presence === presence && user.lastSeenAt === lastSeenAt)
        ? user
        : { ...user, presence, lastSeenAt };
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
  };
}
