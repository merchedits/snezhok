import { MessageCircle, Settings, Sun, Moon, LogOut } from "lucide-react";
import Avatar from "../Avatar.jsx";
import { useAuthStore } from "../../stores/authStore.js";
import { useUIStore } from "../../stores/uiStore.js";

interface SidebarProps {
  onOpenSettings: () => void;
}

export default function Sidebar({ onOpenSettings }: SidebarProps) {
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useUIStore();

  return (
    <nav className="sidebar" aria-label="Main Navigation">
      <div className="app-logo" title="Snezhok Снежок">🌸</div>
      <div className="sidebar-divider" />

      {/* Navigation - Chat (Single room MVP) */}
      <button className="sidebar-btn active" title="Global Chat" aria-label="Global Chat">
        <MessageCircle size={24} />
      </button>

      {/* Theme Toggle Button */}
      <button
        className="sidebar-btn"
        onClick={toggleTheme}
        title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
        aria-label="Toggle dark theme"
      >
        {theme === "light" ? <Moon size={24} /> : <Sun size={24} />}
      </button>

      <div style={{ flex: 1 }} />

      {/* Settings Dialog Trigger */}
      <button
        className="sidebar-btn"
        onClick={onOpenSettings}
        title="Settings"
        aria-label="Settings"
      >
        <Settings size={24} />
      </button>

      {/* Logout Button */}
      <button
        className="sidebar-btn"
        onClick={logout}
        title="Logout"
        aria-label="Logout"
      >
        <LogOut size={24} />
      </button>

      {/* Current User Display Profile */}
      <div style={{ position: "relative", marginTop: "var(--space-2)" }}>
        <Avatar
          displayName={user?.displayName}
          username={user?.username}
          avatarColor={user?.avatarColor}
          size="sm"
          showOnline={true}
          isOnline={true}
        />
      </div>
    </nav>
  );
}
