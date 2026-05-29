import { useState, useRef, useEffect } from "react";
import { Users, MoreHorizontal, PhoneCall, Settings, Moon, Sun, LogOut } from "lucide-react";
import Button from "../Button.jsx";
import { usePresenceStore } from "../../stores/presenceStore.js";
import { useUIStore } from "../../stores/uiStore.js";
import { useVoice } from "../../hooks/useVoice.js";
import { useTranslation } from "../../i18n/index.jsx";

interface ChatHeaderProps {
  onOpenSettings?: () => void;
  onLogout?: () => void;
}

export default function ChatHeader({ onOpenSettings, onLogout }: ChatHeaderProps) {
  const usersList = usePresenceStore((state) => state.usersList);
  const onlineUserIds = usePresenceStore((state) => state.onlineUserIds);
  const toggleMemberPanel = useUIStore((state) => state.toggleMemberPanel);
  const { theme, setTheme } = useUIStore();
  const { joinCall } = useVoice();
  const { t } = useTranslation();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const onlineCount = onlineUserIds.size;
  const totalCount = usersList.length;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDropdownOpen(false);
    };

    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [dropdownOpen]);

  return (
    <header className="chat-header">
      <div className="chat-header-info">
        <h2 style={{ fontSize: "20px", fontWeight: "700" }}>{t('chat.title')}</h2>
        <p style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
          {totalCount} {t('chat.members')}
          <span>•</span>
          <span style={{ 
            display: "inline-block", 
            width: "6px", 
            height: "6px", 
            borderRadius: "50%", 
            background: "var(--color-online)" 
          }} />
          {onlineCount} {t('chat.online')}
        </p>
      </div>

      <div className="header-actions">
        {/* Toggle member panel (desktop collapsible) */}
        <Button
          variant="icon"
          onClick={toggleMemberPanel}
          title="Toggle Member Panel"
          aria-label="Toggle member panel"
          className="member-panel-toggle-btn"
        >
          <Users size={18} />
        </Button>
        <Button
          variant="icon"
          title={t('voice.startCall')}
          aria-label={t('voice.startCall')}
          onClick={() => joinCall()}
        >
          <PhoneCall size={18} />
        </Button>
        
        <div style={{ position: "relative" }} ref={dropdownRef}>
          <Button
            variant="icon"
            title={t('header.moreOptions')}
            aria-label={t('header.moreOptions')}
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <MoreHorizontal size={18} />
          </Button>

          {dropdownOpen && (
            <div className="header-dropdown">
              <button 
                className="header-dropdown-item" 
                onClick={() => { setDropdownOpen(false); onOpenSettings?.(); }}
              >
                <Settings size={16} />
                {t('header.settings')}
              </button>
              <button 
                className="header-dropdown-item" 
                onClick={() => { setDropdownOpen(false); setTheme(theme === "light" ? "dark" : "light"); }}
              >
                {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
                {theme === "light" ? t('header.darkMode') : t('header.lightMode')}
              </button>
              <button 
                className="header-dropdown-item danger" 
                onClick={() => { setDropdownOpen(false); onLogout?.(); }}
              >
                <LogOut size={16} />
                {t('header.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
