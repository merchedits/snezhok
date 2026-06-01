import { Hash, MessageCircle, Moon, Settings, Sun, UsersRound } from "lucide-react";
import Avatar from "../Avatar.jsx";
import { useAuthStore } from "../../stores/authStore.js";
import { useMessageStore, Conversation } from "../../stores/messageStore.js";
import { useUIStore } from "../../stores/uiStore.js";
import { useTranslation } from "../../i18n/index.jsx";

interface SidebarProps {
  onOpenSettings: () => void;
}

function getConversationLabel(conversation: Conversation, currentUserId?: string) {
  if (conversation.type === "dm") {
    return conversation.recipient?.displayName || "Direct message";
  }

  const names = conversation.members
    .filter((member) => member.id !== currentUserId)
    .map((member) => member.displayName);

  return names.slice(0, 3).join(", ") || "Group chat";
}

export default function Sidebar({ onOpenSettings }: SidebarProps) {
  const { user } = useAuthStore();
  const { theme, toggleTheme } = useUIStore();
  const { t } = useTranslation();
  const conversations = useMessageStore((state) => state.conversations);
  const activeConversationId = useMessageStore((state) => state.activeConversationId);
  const setActiveConversationId = useMessageStore((state) => state.setActiveConversationId);

  const dmConversations = conversations.filter((conversation) => conversation.type === "dm");
  const groupConversations = conversations.filter((conversation) => conversation.type === "group");

  return (
    <nav className="sidebar" aria-label="Main Navigation">
      <div className="sidebar-brand-row">
        <div className="app-logo" title="Snezhok">S</div>
        <div className="sidebar-brand-copy">
          <span>Snezhok</span>
          <small>Private chat</small>
        </div>
      </div>

      <div className="sidebar-section">
        <button
          className={`conversation-nav-item ${activeConversationId === "global" ? "active" : ""}`}
          title={t('sidebar.globalChat')}
          aria-label={t('sidebar.globalChat')}
          onClick={() => setActiveConversationId("global")}
        >
          <span className="conversation-nav-icon">
            <Hash size={16} />
          </span>
          <span className="conversation-nav-text">{t('sidebar.globalChat')}</span>
        </button>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">Direct messages</div>
        {dmConversations.length === 0 ? (
          <div className="sidebar-empty">Right click a member to start one.</div>
        ) : (
          dmConversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`conversation-nav-item ${activeConversationId === conversation.id ? "active" : ""}`}
              onClick={() => setActiveConversationId(conversation.id)}
              title={getConversationLabel(conversation, user?.id)}
            >
              <MessageCircle size={15} />
              <span className="conversation-nav-text">{getConversationLabel(conversation, user?.id)}</span>
            </button>
          ))
        )}
      </div>

      {groupConversations.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-title">Group chats</div>
          {groupConversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`conversation-nav-item ${activeConversationId === conversation.id ? "active" : ""}`}
              onClick={() => setActiveConversationId(conversation.id)}
              title={getConversationLabel(conversation, user?.id)}
            >
              <UsersRound size={15} />
              <span className="conversation-nav-text">{getConversationLabel(conversation, user?.id)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="sidebar-spacer" />

      <div className="sidebar-utility-row">
        <button
          className="sidebar-btn"
          onClick={toggleTheme}
          title={theme === "light" ? t('settings.darkMode') : t('settings.lightMode')}
          aria-label="Toggle dark theme"
        >
          {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        <button
          className="sidebar-btn"
          onClick={onOpenSettings}
          title={t('sidebar.settings')}
          aria-label={t('sidebar.settings')}
        >
          <Settings size={18} strokeWidth={2} />
        </button>

        <Avatar
          displayName={user?.displayName}
          username={user?.username}
          avatarColor={user?.avatarColor}
          avatarUrl={user?.avatarUrl}
          size="sm"
          showOnline={true}
          isOnline={true}
        />
      </div>
    </nav>
  );
}
