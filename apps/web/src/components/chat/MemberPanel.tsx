import { PhoneCall, PhoneOff } from "lucide-react";
import Avatar from "../Avatar.jsx";
import Button from "../Button.jsx";
import { usePresenceStore } from "../../stores/presenceStore.js";
import { useVoiceStore } from "../../stores/voiceStore.js";
import { useAuthStore } from "../../stores/authStore.js";
import { useVoice } from "../../hooks/useVoice.js";

export default function MemberPanel() {
  const usersList = usePresenceStore((state) => state.usersList);
  const voiceParticipants = useVoiceStore((state) => state.participants);
  const isInCall = useVoiceStore((state) => state.isInCall);
  const volumes = useVoiceStore((state) => state.volumes);
  const setVolume = useVoiceStore((state) => state.setVolume);
  const localUser = useAuthStore((state) => state.user);

  const { joinCall, leaveCall } = useVoice();

  // Helper to check if a user is in a voice call
  const isUserInVoice = (userId: string) => {
    return voiceParticipants.some((p) => p.userId === userId);
  };

  // Helper to check if a user is speaking in a voice call
  const isUserSpeaking = (userId: string) => {
    return voiceParticipants.find((p) => p.userId === userId)?.isSpeaking || false;
  };

  // Separate online and offline
  const onlineUsers = usersList.filter((u) => u.isOnline);
  const offlineUsers = usersList.filter((u) => !u.isOnline);

  return (
    <aside className="member-panel" aria-label="Member List">
      <div className="member-panel-header">Members</div>

      {/* Online List */}
      <div className="member-section-label">Online — {onlineUsers.length}</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {onlineUsers.map((member) => (
          <div key={member.id} className="member-item">
            <Avatar
              displayName={member.displayName}
              username={member.username}
              avatarColor={member.avatarColor}
              size="xs"
              showOnline={true}
              isOnline={true}
              isSpeaking={isUserSpeaking(member.id)}
            />
            <span className="member-name">{member.displayName}</span>
            {isUserInVoice(member.id) && (
              <div
                className="presence-dot presence-speaking"
                title="In voice call"
                style={{ width: "6px", height: "6px" }}
              />
            )}
          </div>
        ))}

        {/* Offline List */}
        {offlineUsers.length > 0 && (
          <>
            <div className="member-section-label" style={{ marginTop: "12px" }}>
              Offline — {offlineUsers.length}
            </div>
            {offlineUsers.map((member) => (
              <div key={member.id} className="member-item" style={{ opacity: 0.6 }}>
                <Avatar
                  displayName={member.displayName}
                  username={member.username}
                  avatarColor={member.avatarColor}
                  size="xs"
                  showOnline={true}
                  isOnline={false}
                />
                <span className="member-name">{member.displayName}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Voice widget at the bottom of the panel */}
      <div className="voice-in-panel">
        <div className="voice-panel-title">
          <PhoneCall size={12} style={{ color: "#6B5B9E" }} />
          <span>Voice Channel</span>
        </div>

        {voiceParticipants.length > 0 ? (
          <>
            <div className="voice-member-chips">
              {voiceParticipants.map((p) => {
                const isLocal = localUser?.id === p.userId;
                const pVolume = volumes[p.socketId] ?? 1;

                return (
                  <div key={p.socketId} style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', marginBottom: '8px' }}>
                    <div className="voice-chip" style={{ width: '100%' }}>
                      <div
                        className="voice-chip-avatar"
                        style={{
                          backgroundColor: p.avatarColor,
                          border: p.isSpeaking ? "2px solid var(--color-lavender)" : undefined,
                        }}
                      >
                        {p.displayName.slice(0, 2).toUpperCase()}
                      </div>
                      <span>{p.displayName} {isLocal && "(You)"}</span>
                    </div>
                    {!isLocal && (
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={pVolume}
                        onChange={(e) => setVolume(p.socketId, parseFloat(e.target.value))}
                        title="Volume"
                        style={{ width: '100%', height: '4px', cursor: 'pointer' }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {isInCall ? (
              <Button
                variant="danger"
                onClick={leaveCall}
                style={{ width: "100%", height: "32px", fontSize: "var(--text-sm)" }}
                aria-label="Disconnect voice call"
              >
                <PhoneOff size={12} />
                Disconnect
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={joinCall}
                className="join-voice-btn"
                style={{ width: "100%", height: "32px", fontSize: "var(--text-sm)" }}
                aria-label="Join voice call"
              >
                <PhoneCall size={12} />
                Join Call
              </Button>
            )}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
              No one is in the call. Start one to hang out!
            </p>
            <Button
              variant="ghost"
              onClick={joinCall}
              style={{ width: "100%", height: "32px", fontSize: "var(--text-sm)" }}
              aria-label="Start voice call"
            >
              <PhoneCall size={12} />
              Start Call
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
