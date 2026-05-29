import { Users, MoreHorizontal } from "lucide-react";
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
      <div className="chat-header-info">
        <h2 style={{ fontSize: "20px", fontWeight: "700" }}>The Crew 🌸</h2>
        <p style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
          {totalCount} {totalCount === 1 ? "member" : "members"}
          <span>•</span>
          <span style={{ 
            display: "inline-block", 
            width: "6px", 
            height: "6px", 
            borderRadius: "50%", 
            background: "var(--color-online)" 
          }} />
          {onlineCount} online
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
          title="More options"
          aria-label="More options"
        >
          <MoreHorizontal size={18} />
        </Button>
      </div>
    </header>
  );
}
