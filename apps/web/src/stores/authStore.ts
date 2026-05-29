import { create } from "zustand";

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string;
  isAdmin: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  checkingSession: boolean;
  loginError: string | null;
  registerError: string | null;
  checkSession: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  register: (inviteCode: string, username: string, password: string, displayName?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<boolean>;
  updateAvatarColor: (avatarColor: string) => Promise<boolean>;
  updateAvatarImage: (file: File) => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  checkingSession: true,
  loginError: null,
  registerError: null,

  checkSession: async () => {
    set({ checkingSession: true });
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        set({ user: data.user, isAuthenticated: true });
      } else {
        set({ user: null, isAuthenticated: false });
      }
    } catch (err) {
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ checkingSession: false });
    }
  },

  login: async (username, password) => {
    set({ loginError: null });
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (res.ok) {
        set({ user: data.user, isAuthenticated: true, loginError: null });
        return true;
      } else {
        set({ loginError: data.error || "Login failed" });
        return false;
      }
    } catch (err) {
      set({ loginError: "Network error occurred" });
      return false;
    }
  },

  register: async (inviteCode, username, password, displayName) => {
    set({ registerError: null });
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode, username, password, displayName }),
      });

      const data = await res.json();
      if (res.ok) {
        set({ registerError: null });
        // Automatically attempt login after successful registration
        const success = await get().login(username, password);
        return success;
      } else {
        set({ registerError: data.error || "Registration failed" });
        return false;
      }
    } catch (err) {
      set({ registerError: "Network error occurred" });
      return false;
    }
  },

  logout: async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      // Ignore network errors on logout
    } finally {
      set({ user: null, isAuthenticated: false });
    }
  },

  updateDisplayName: async (displayName) => {
    try {
      const res = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });

      if (res.ok) {
        set((state) => ({
          user: state.user ? { ...state.user, displayName } : null,
        }));
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  },

  updateAvatarColor: async (avatarColor) => {
    const currentUser = get().user;
    if (!currentUser) return false;

    try {
      const res = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: currentUser.displayName, avatarColor }),
      });

      if (res.ok) {
        set((state) => ({
          user: state.user ? { ...state.user, avatarColor } : null,
        }));
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  },

  updateAvatarImage: async (file) => {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/users/me/avatar", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        set((state) => ({
          user: state.user ? { ...state.user, avatarUrl: data.avatarUrl } : null,
        }));
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  },
}));
