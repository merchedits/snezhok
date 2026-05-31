import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { useVoiceStore } from "../../stores/voiceStore.js";
import Avatar from "../Avatar.jsx";
import { useTranslation } from "../../i18n/index.jsx";
import VoiceVolumeMenu from "./VoiceVolumeMenu.jsx";
import { useAuthStore } from "../../stores/authStore.js";

export default function InCallCard() {
  const { participants, isInCall } = useVoiceStore();
  const [callDuration, setCallDuration] = useState(0);
  const { user: currentUser } = useAuthStore();
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

  // Only show if there's someone in the call
  if (participants.length === 0) return null;

  return (
    <div className="in-call-container" style={{
      display: "flex",
      justifyContent: "center",
      flexWrap: "wrap",
      gap: "20px",
      marginTop: "24px",
      marginBottom: "24px",
      width: "100%",
    }}>
      {participants.map((participant) => (
        <div 
          key={participant.socketId}
          onContextMenu={(e) => {
            if (participant.userId === currentUser?.id) return;
            e.preventDefault();
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              userId: participant.userId,
              displayName: participant.displayName,
              socketId: participant.socketId
            });
          }}
          title={participant.userId === currentUser?.id ? undefined : "Right click to adjust volume"}
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
            cursor: participant.userId === currentUser?.id ? "default" : "context-menu",
            border: participant.isSpeaking ? "2px solid var(--color-online)" : "2px solid transparent",
            transition: "border 0.2s ease"
          }}
        >
          <Avatar 
            displayName={participant.displayName} 
            username={participant.displayName} 
            avatarColor={participant.avatarColor} 
            avatarUrl={participant.avatarUrl || undefined}
            size="lg" 
            isSpeaking={participant.isSpeaking}
          />
          
          <div style={{ position: "absolute", top: "32px", right: "24px" }}>
            <Activity size={16} color={participant.isSpeaking ? "var(--color-online)" : "var(--color-text-tertiary)"} />
          </div>

          <div style={{ textAlign: "center" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "4px" }}>
              {participant.displayName}
            </h3>
            <p style={{ fontSize: "13px", color: participant.isSpeaking ? "var(--color-online)" : "var(--color-text-secondary)", marginBottom: "4px" }}>
              {t('voice.inVoiceCall')}
            </p>
            <p style={{ fontSize: "13px", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
              {formatDuration(callDuration)}
            </p>
          </div>
        </div>
      ))}

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
