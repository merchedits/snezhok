import { Users } from "lucide-react";
import Button from "../Button.jsx";
import { usePresenceStore } from "../../stores/presenceStore.js";
import { useUIStore } from "../../stores/uiStore.js";

export default function ChatHeader() {
  const usersList = usePresenceStore((state) => state.usersList);
  const onlineUserIds = usePresenceStore((state) => state.onlineUserIds);
  const toggleMemberPanel = useUIStore((state) => state.toggleMemberPanel);

  const onlineCount = onlineUserIds.size;
  const totalCount = usersList.length;

  return (
    <header className="chat-header">
      {/* Mobile menu toggle or brand icon */}
      <div className="chat-header-icon">
        <Users size={18} style={{ color: "var(--color-peach-dark)" }} />
      </div>

      <div className="chat-header-info">
        <h2>The Crew 🌸</h2>
        <p>
          {totalCount} {totalCount === 1 ? "member" : "members"} · {onlineCount} online
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
          <Users size={16} />
        </Button>
      </div>
    </header>
  );
}
