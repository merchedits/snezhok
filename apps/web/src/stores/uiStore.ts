import { create } from "zustand";

interface UIState {
  theme: "light" | "dark";
  memberPanelOpen: boolean;
  channelsSidebarOpen: boolean;
  toggleTheme: () => void;
  setTheme: (theme: "light" | "dark") => void;
  setMemberPanelOpen: (open: boolean) => void;
  toggleMemberPanel: () => void;
  toggleChannelsSidebar: () => void;
  setChannelsSidebarOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => {
  // Check local storage or system preference
  const getInitialTheme = (): "light" | "dark" => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  const initialTheme = getInitialTheme();
  document.documentElement.setAttribute("data-theme", initialTheme);

  return {
    theme: initialTheme,
    memberPanelOpen: true, // Desktop default open
    channelsSidebarOpen: false, // Mobile default closed
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
  };
});
