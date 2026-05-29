import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { useVoiceStore } from "../../stores/voiceStore.js";
import Avatar from "../Avatar.jsx";
import { useTranslation } from "../../i18n/index.jsx";
import VoiceVolumeMenu from "./VoiceVolumeMenu.jsx";

export default function InCallCard() {
  const { participants, isInCall } = useVoiceStore();
  const [callDuration, setCallDuration] = useState(0);
  const { t } = useTranslation();
  
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    userId: string;
    displayName: string;
    socketId: string;
  } | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isInCall) {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [isInCall]);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Only show if there's someone in the call and we're not currently rendering a massive grid
  if (participants.length === 0) return null;

  // Render the primary speaker or first participant
  const activeParticipant = participants.find(p => p.isSpeaking) || participants[0];

  return (
    <div className="in-call-card" style={{
      display: "flex",
      justifyContent: "center",
      marginTop: "24px",
      marginBottom: "24px",
    }}>
      <div 
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            userId: activeParticipant.userId,
            displayName: activeParticipant.displayName,
            socketId: activeParticipant.socketId
          });
        }}
        title="Right click to adjust volume"
        style={{
          background: "var(--color-bg-elevated)",
          borderRadius: "24px",
          padding: "24px 32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
          minWidth: "160px",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.15)",
          position: "relative",
          cursor: "context-menu"
        }}
      >
        <Avatar 
          displayName={activeParticipant.displayName} 
          username={activeParticipant.displayName} 
          avatarColor={activeParticipant.avatarColor} 
          avatarUrl={activeParticipant.avatarUrl || undefined}
          size="lg" 
          isSpeaking={activeParticipant.isSpeaking}
        />
        
        <div style={{ position: "absolute", top: "32px", right: "24px" }}>
          <Activity size={16} color="var(--color-online)" />
        </div>

        <div style={{ textAlign: "center" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "4px" }}>
            {activeParticipant.displayName}
          </h3>
          <p style={{ fontSize: "13px", color: "var(--color-online)", marginBottom: "4px" }}>
            {t('voice.inVoiceCall')}
          </p>
          <p style={{ fontSize: "13px", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
            {formatDuration(callDuration)}
          </p>
        </div>
      </div>

      {contextMenu && (
        <VoiceVolumeMenu
          x={contextMenu.x}
          y={contextMenu.y}
          userId={contextMenu.userId}
          displayName={contextMenu.displayName}
          socketId={contextMenu.socketId}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
