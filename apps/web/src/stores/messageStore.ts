import { create } from "zustand";

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
  };
  file: MessageFile | null;
  reactions: MessageReaction[];
}

interface MessageState {
  messages: Message[];
  isLoading: boolean;
  hasMore: boolean;
  addMessage: (msg: Message) => void;
  setMessages: (msgs: Message[]) => void;
  updateMessageReactions: (messageId: string, reactions: MessageReaction[]) => void;
  loadHistory: (beforeTimestamp?: number) => Promise<void>;
  clearMessages: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  isLoading: false,
  hasMore: true,

  addMessage: (msg) =>
    set((state) => {
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

  loadHistory: async (beforeTimestamp) => {
    set({ isLoading: true });
    try {
      const url = beforeTimestamp
        ? `/api/messages?before=${beforeTimestamp}&limit=50`
        : "/api/messages?limit=50";

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const fetchedMsgs = data.messages || [];

        set((state) => {
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
              hasMore: fetchedMsgs.length >= 50 || state.hasMore,
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

  clearMessages: () => set({ messages: [], hasMore: true, isLoading: false }),
}));
