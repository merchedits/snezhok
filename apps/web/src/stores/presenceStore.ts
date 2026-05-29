import { create } from "zustand";

export interface PresenceUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string;
  isAdmin: boolean;
  createdAt: number;
  lastSeenAt: number;
  isOnline: boolean;
}

interface PresenceState {
  usersList: PresenceUser[];
  onlineUserIds: Set<string>;
  typingUserIds: string[];
  setUsersList: (users: PresenceUser[]) => void;
  updateUserPresence: (userId: string, isOnline: boolean, lastSeenAt?: number) => void;
  setTypingUsers: (userIds: string[]) => void;
  fetchUsers: () => Promise<void>;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  usersList: [],
  onlineUserIds: new Set<string>(),
  typingUserIds: [],

  setUsersList: (users) => {
    const onlineIds = new Set<string>(
      users.filter((u) => u.isOnline).map((u) => u.id)
    );
    set({ usersList: users, onlineUserIds: onlineIds });
  },

  updateUserPresence: (userId, isOnline, lastSeenAt) =>
    set((state) => {
      const nextOnline = new Set(state.onlineUserIds);
      if (isOnline) {
        nextOnline.add(userId);
      } else {
        nextOnline.delete(userId);
      }

      const nextList = state.usersList.map((u) => {
        if (u.id === userId) {
          return {
            ...u,
            isOnline,
            lastSeenAt: lastSeenAt !== undefined ? lastSeenAt : Date.now(),
          };
        }
        return u;
      });

      return { usersList: nextList, onlineUserIds: nextOnline };
    }),

  setTypingUsers: (userIds) => set({ typingUserIds: userIds }),

  fetchUsers: async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        // Since API returns flat list, we need to cross-reference with onlineUserIds
        // Wait, online presence is set in socket connection, so socket event triggers updates
        const presenceList = data.users.map((u: any) => ({
          ...u,
          isOnline: usePresenceStore.getState().onlineUserIds.has(u.id),
        }));
        set({ usersList: presenceList });
      }
    } catch (err) {
      console.error("Failed to fetch users list", err);
    }
  },
}));
