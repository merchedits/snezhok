import { create } from "zustand";

interface UIState {
  theme: "light" | "dark";
  memberPanelOpen: boolean;
  channelsSidebarOpen: boolean;
  notificationsMuted: boolean;
  notificationSound: "sakura_pop" | "bubble_tap" | "crystal_ring" | "digital_beep" | "none";
  desktopNotificationsEnabled: boolean;
  toggleTheme: () => void;
  setTheme: (theme: "light" | "dark") => void;
  setMemberPanelOpen: (open: boolean) => void;
  toggleMemberPanel: () => void;
  toggleChannelsSidebar: () => void;
  setChannelsSidebarOpen: (open: boolean) => void;
  setNotificationsMuted: (muted: boolean) => void;
  setNotificationSound: (sound: "sakura_pop" | "bubble_tap" | "crystal_ring" | "digital_beep" | "none") => void;
  setDesktopNotificationsEnabled: (enabled: boolean) => Promise<boolean>;
}

export const useUIStore = create<UIState>((set) => {
  // Check local storage or system preference
  const getInitialTheme = (): "light" | "dark" => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  const getInitialMuted = (): boolean => {
    return localStorage.getItem("notifications_muted") === "true";
  };

  const getInitialSound = (): "sakura_pop" | "bubble_tap" | "crystal_ring" | "digital_beep" | "none" => {
    const saved = localStorage.getItem("notification_sound");
    if (["sakura_pop", "bubble_tap", "crystal_ring", "digital_beep", "none"].includes(saved || "")) {
      return saved as any;
    }
    return "sakura_pop";
  };

  const getInitialDesktopNotifications = (): boolean => {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    return Notification.permission === "granted" && localStorage.getItem("desktop_notifications_enabled") === "true";
  };

  const initialTheme = getInitialTheme();
  document.documentElement.setAttribute("data-theme", initialTheme);

  return {
    theme: initialTheme,
    memberPanelOpen: true, // Desktop default open
    channelsSidebarOpen: false, // Mobile default closed
    notificationsMuted: getInitialMuted(),
    notificationSound: getInitialSound(),
    desktopNotificationsEnabled: getInitialDesktopNotifications(),
    toggleTheme: () => set((state) => {
      const next = state.theme === "light" ? "dark" : "light";
      localStorage.setItem("theme", next);
      document.documentElement.setAttribute("data-theme", next);
      return { theme: next };
    }),
    setTheme: (theme) => set(() => {
      localStorage.setItem("theme", theme);
      document.documentElement.setAttribute("data-theme", theme);
      return { theme };
    }),
    setMemberPanelOpen: (open) => set({ memberPanelOpen: open }),
    toggleMemberPanel: () => set((state) => ({ memberPanelOpen: !state.memberPanelOpen })),
    toggleChannelsSidebar: () => set((state) => ({ channelsSidebarOpen: !state.channelsSidebarOpen })),
    setChannelsSidebarOpen: (open) => set({ channelsSidebarOpen: open }),
    setNotificationsMuted: (muted) => {
      localStorage.setItem("notifications_muted", muted ? "true" : "false");
      set({ notificationsMuted: muted });
    },
    setNotificationSound: (sound) => {
      localStorage.setItem("notification_sound", sound);
      set({ notificationSound: sound });
    },
    setDesktopNotificationsEnabled: async (enabled) => {
      if (!enabled) {
        localStorage.setItem("desktop_notifications_enabled", "false");
        set({ desktopNotificationsEnabled: false });
        return false;
      }

      if (!("Notification" in window)) {
        alert("This browser does not support desktop notifications.");
        return false;
      }

      try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          localStorage.setItem("desktop_notifications_enabled", "true");
          set({ desktopNotificationsEnabled: true });
          return true;
        } else {
          localStorage.setItem("desktop_notifications_enabled", "false");
          set({ desktopNotificationsEnabled: false });
          alert("Permission for notifications was denied. You may need to enable them in your browser settings.");
          return false;
        }
      } catch (err) {
        console.error("Failed to request notification permission", err);
        return false;
      }
    },
  };
});
