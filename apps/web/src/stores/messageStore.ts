import { create } from "zustand";
import { getSocket } from "../lib/socket.js";

export interface MessageFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface Message {
  id: string;
  userId: string;
  conversationId: string;
  content: string;
  type: "text" | "file" | "system";
  fileId: string | null;
  replyToId: string | null;
  createdAt: number;
  editedAt: number | null;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarColor: string;
    avatarUrl?: string;
  };
  file: MessageFile | null;
  reactions: MessageReaction[];
}

export interface ConversationUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string;
}

export interface Conversation {
  id: string;
  type: "dm" | "group";
  createdAt: number;
  recipient?: ConversationUser;
  members: ConversationUser[];
}

interface MessageState {
  messages: Message[];
  isLoading: boolean;
  hasMore: boolean;
  replyingTo: Message | null;
  conversations: Conversation[];
  activeConversationId: string;
  setActiveConversationId: (id: string) => void;
  fetchConversations: () => Promise<void>;
  startDM: (targetUserId: string) => Promise<string>;
  startGroup: (memberIds: string[]) => Promise<string>;
  addMessage: (msg: Message) => void;
  setMessages: (msgs: Message[]) => void;
  updateMessageReactions: (messageId: string, reactions: MessageReaction[]) => void;
  removeMessage: (messageId: string) => void;
  editMessage: (msg: Message) => void;
  setReplyingTo: (msg: Message | null) => void;
  clearReplyingTo: () => void;
  loadHistory: (beforeTimestamp?: number) => Promise<void>;
  clearMessages: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  isLoading: false,
  hasMore: true,
  replyingTo: null,
  conversations: [],
  activeConversationId: "global",

  setActiveConversationId: (id) => {
    set({ activeConversationId: id, messages: [], hasMore: true, replyingTo: null });

    try {
      const socket = getSocket();
      socket.emit("room:join", { conversationId: id });
      socket.emit("voice:get-state", { conversationId: id });
    } catch (e) {
      console.warn("Socket not connected yet, skipping room switch.", e);
    }
  },

  fetchConversations: async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        set({ conversations: data.conversations || [] });
      }
    } catch (err) {
      console.error("Failed to fetch conversations", err);
    }
  },

  startDM: async (targetUserId) => {
    try {
      const res = await fetch("/api/conversations/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId }),
      });
      if (res.ok) {
        const data = await res.json();
        await useMessageStore.getState().fetchConversations();
        
        // Let our socket join this DM conversation room dynamically in real time
        try {
          const socket = getSocket();
          socket.emit("room:join", { conversationId: data.conversationId });
        } catch (e) {
          console.warn("Socket not connected yet, skipping instant room join.", e);
        }

        useMessageStore.getState().setActiveConversationId(data.conversationId);
        return data.conversationId;
      }
      throw new Error("Failed to start DM");
    } catch (err) {
      console.error("Failed to start DM", err);
      throw err;
    }
  },

  startGroup: async (memberIds) => {
    try {
      const uniqueMemberIds = Array.from(new Set(memberIds)).filter(Boolean);
      const res = await fetch("/api/conversations/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberIds: uniqueMemberIds }),
      });
      if (res.ok) {
        const data = await res.json();
        await useMessageStore.getState().fetchConversations();
        useMessageStore.getState().setActiveConversationId(data.conversationId);
        return data.conversationId;
      }

      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to create group");
    } catch (err) {
      console.error("Failed to create group", err);
      throw err;
    }
  },

  addMessage: (msg) =>
    set((state) => {
      // Ignore if message belongs to another conversation
      if (msg.conversationId !== state.activeConversationId) {
        // Refresh conversations in background to update DM list
        state.fetchConversations();
        return state;
      }
      // Avoid duplicates
      if (state.messages.some((m) => m.id === msg.id)) return state;
      return { messages: [...state.messages, msg] };
    }),

  setMessages: (msgs) => set({ messages: msgs, hasMore: msgs.length >= 50 }),

  updateMessageReactions: (messageId, nextReactions) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, reactions: nextReactions } : m
      ),
    })),

  removeMessage: (messageId) =>
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== messageId),
    })),

  editMessage: (updatedMsg) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === updatedMsg.id ? updatedMsg : m
      ),
    })),

  setReplyingTo: (msg) => set({ replyingTo: msg }),
  clearReplyingTo: () => set({ replyingTo: null }),

  loadHistory: async (beforeTimestamp) => {
    set({ isLoading: true });
    try {
      const activeId = useMessageStore.getState().activeConversationId;
      let url = `/api/messages?conversationId=${activeId}&limit=50`;
      if (beforeTimestamp) {
        url += `&before=${beforeTimestamp}`;
      }

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const fetchedMsgs = data.messages || [];

        set((state) => {
          if (state.activeConversationId !== activeId) {
            return state;
          }

          if (beforeTimestamp) {
            // Prepend history
            return {
              messages: [...fetchedMsgs, ...state.messages],
              hasMore: fetchedMsgs.length >= 50,
            };
          } else {
            // Initial load or reconnect: merge and deduplicate
            const existingIds = new Set(state.messages.map((m) => m.id));
            const newMsgs = fetchedMsgs.filter((m: Message) => !existingIds.has(m.id));
            
            // Sort combined messages by createdAt just in case
            const combined = [...state.messages, ...newMsgs].sort((a, b) => a.createdAt - b.createdAt);
            
            return {
              messages: combined,
              hasMore: fetchedMsgs.length >= 50,
            };
          }
        });
      }
    } catch (err) {
      console.error("Failed to load message history", err);
    } finally {
      set({ isLoading: false });
    }
  },

  clearMessages: () => set({ messages: [], hasMore: true, isLoading: false, replyingTo: null }),
}));
