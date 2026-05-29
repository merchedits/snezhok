import { X, Activity } from "lucide-react";
import Avatar from "../Avatar.jsx";
import Button from "../Button.jsx";
import { usePresenceStore } from "../../stores/presenceStore.js";
import { useVoiceStore } from "../../stores/voiceStore.js";
import { useUIStore } from "../../stores/uiStore.js";

export default function MemberPanel() {
  const usersList = usePresenceStore((state) => state.usersList);
  const voiceParticipants = useVoiceStore((state) => state.participants);
  const toggleMemberPanel = useUIStore((state) => state.toggleMemberPanel);

  // Helper to check if a user is in a voice call
  const isUserInVoice = (userId: string) => {
    return voiceParticipants.some((p) => p.userId === userId);
  };

  // Helper to check if a user is speaking in a voice call
  const isUserSpeaking = (userId: string) => {
    return voiceParticipants.find((p) => p.userId === userId)?.isSpeaking || false;
  };

  // Lists
  const inCallUsers = usersList.filter((u) => isUserInVoice(u.id));
  const onlineUsersNotInCall = usersList.filter((u) => u.isOnline && !isUserInVoice(u.id));
  const offlineUsers = usersList.filter((u) => !u.isOnline);

  return (
    <aside className="member-panel" aria-label="Member List">
      <div 
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", 
          padding: "24px 24px 16px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "16px" }}>Members</span>
        <Button variant="ghost" onClick={toggleMemberPanel} style={{ padding: 0, width: "24px", height: "24px" }}>
          <X size={18} />
        </Button>
      </div>

      <div style={{ overflowY: "auto", flex: 1, padding: "16px 24px" }}>
        
        {/* IN CALL NOW */}
        {inCallUsers.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            <div className="member-section-label" style={{ padding: "0 0 12px 0", fontSize: "11px" }}>
              IN CALL NOW
            </div>
            {inCallUsers.map((member) => (
              <div 
                key={member.id} 
                style={{
                  background: "var(--color-bg-elevated)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "16px",
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "8px",
                }}
              >
                <Avatar
                  displayName={member.displayName}
                  username={member.username}
                  avatarColor={member.avatarColor}
                  size="sm"
                  showOnline={true}
                  isOnline={true}
                  isSpeaking={isUserSpeaking(member.id)}
                />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {member.displayName}
                  </span>
                  <span style={{ fontSize: "12px", color: "var(--color-online)" }}>
                    In voice call
                  </span>
                </div>
                <Activity size={14} color="var(--color-online)" />
              </div>
            ))}
          </div>
        )}

        {/* ONLINE */}
        {onlineUsersNotInCall.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            <div className="member-section-label" style={{ padding: "0 0 12px 0", fontSize: "11px" }}>
              ONLINE — {onlineUsersNotInCall.length}
            </div>
            {onlineUsersNotInCall.map((member) => (
              <div 
                key={member.id} 
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "8px 0",
                }}
              >
                <Avatar
                  displayName={member.displayName}
                  username={member.username}
                  avatarColor={member.avatarColor}
                  size="sm"
                  showOnline={true}
                  isOnline={true}
                />
                <span style={{ fontSize: "14px", color: "var(--color-text-primary)", fontWeight: 500 }}>
                  {member.displayName}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* OFFLINE */}
        {offlineUsers.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            <div className="member-section-label" style={{ padding: "0 0 12px 0", fontSize: "11px" }}>
              OFFLINE — {offlineUsers.length}
            </div>
            {offlineUsers.map((member) => (
              <div 
                key={member.id} 
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "8px 0",
                  opacity: 0.5,
                }}
              >
                <Avatar
                  displayName={member.displayName}
                  username={member.username}
                  avatarColor={member.avatarColor}
                  size="sm"
                  showOnline={false}
                  isOnline={false}
                />
                <span style={{ fontSize: "14px", color: "var(--color-text-secondary)", fontWeight: 500 }}>
                  {member.displayName}
                </span>
              </div>
            ))}
          </div>
        )}

      </div>
    </aside>
  );
}
