import { useEffect } from "react";
import { MessageSquare, Globe } from "lucide-react";
import { useMessageStore } from "../../stores/messageStore.js";
import { usePresenceStore } from "../../stores/presenceStore.js";
import { useVoiceStore } from "../../stores/voiceStore.js";
import { useUIStore } from "../../stores/uiStore.js";
import { useTranslation } from "../../i18n/index.jsx";
import Avatar from "../Avatar.jsx";

export default function DMSidebar() {
  const { conversations, activeConversationId, setActiveConversationId, fetchConversations } = useMessageStore();
  const { onlineUserIds } = usePresenceStore();
  const voiceParticipants = useVoiceStore((state) => state.participants);
  const channelsSidebarOpen = useUIStore((state) => state.channelsSidebarOpen);
  const setChannelsSidebarOpen = useUIStore((state) => state.setChannelsSidebarOpen);
  const { t } = useTranslation();

  // Load conversations list
  useEffect(() => {
    fetchConversations();
  }, []);

  const isUserSpeaking = (userId: string) => {
    return voiceParticipants.find((p) => p.userId === userId)?.isSpeaking || false;
  };

  const handleSelectChannel = (id: string) => {
    setActiveConversationId(id);
    // On mobile, close the drawer after selection
    setChannelsSidebarOpen(false);
  };

  return (
    <aside className={`dm-sidebar ${channelsSidebarOpen ? "open" : ""}`} aria-label="Channels and Direct Messages">
      {/* Sidebar Header Branding */}
      <div className="dm-sidebar-header">
        <h3 className="dm-sidebar-title">Snezhok 🌸</h3>
      </div>

      <div className="dm-sidebar-content">
        {/* Main Public Channels Section */}
        <div className="dm-section">
          <div className="dm-section-label">{t('sidebar.globalChat')}</div>
          
          <button
            onClick={() => handleSelectChannel("global")}
            className={`dm-item ${activeConversationId === "global" ? "active" : ""}`}
            title="Global Chat Channel"
          >
            <div className="dm-item-avatar-wrapper global-avatar">
              <Globe size={16} strokeWidth={2.5} />
            </div>
            <span className="dm-item-name"># general</span>
          </button>
        </div>

        {/* Direct Messages Section */}
        <div className="dm-section" style={{ marginTop: "20px" }}>
          <div className="dm-section-label">
            <span>{t('settings.myProfile') === "Мой профиль" ? "ЛИЧНЫЕ СООБЩЕНИЯ" : "DIRECT MESSAGES"}</span>
          </div>

          {conversations.length === 0 ? (
            <div className="dm-sidebar-empty">
              <MessageSquare size={16} style={{ opacity: 0.6 }} />
              <span>No direct messages</span>
            </div>
          ) : (
            <div className="dm-list-scroll">
              {conversations.map((conv) => {
                const isOnline = onlineUserIds.has(conv.recipient.id);
                const isSpeaking = isUserSpeaking(conv.recipient.id);
                const isActive = activeConversationId === conv.id;

                return (
                  <button
                    key={conv.id}
                    onClick={() => handleSelectChannel(conv.id)}
                    className={`dm-item ${isActive ? "active" : ""}`}
                  >
                    <Avatar
                      displayName={conv.recipient.displayName}
                      username={conv.recipient.username}
                      avatarColor={conv.recipient.avatarColor}
                      avatarUrl={conv.recipient.avatarUrl}
                      size="xs"
                      showOnline={true}
                      isOnline={isOnline}
                      isSpeaking={isSpeaking}
                    />
                    <span className="dm-item-name">{conv.recipient.displayName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
