import { useState, useEffect } from "react";
import { Mic, MicOff, PhoneOff, PhoneCall, Monitor, MonitorOff, MoreHorizontal, Activity } from "lucide-react";
import Button from "../Button.jsx";
import { useVoiceStore } from "../../stores/voiceStore.js";
import { useVoice } from "../../hooks/useVoice.js";
import VoiceSettings from "./VoiceSettings.jsx";
import Avatar from "../Avatar.jsx";

export default function VoiceBanner() {
  const { participants, isInCall, isMuted } = useVoiceStore();
  const { joinCall, leaveCall, toggleMute, startScreenshare, stopScreenshare, isScreensharing } = useVoice();
  const [showSettings, setShowSettings] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

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

  if (!isInCall && participants.length === 0) return null;

  // Render when a call is active or we are in it
  return (
    <div 
      className="voice-banner" 
      role="status" 
      aria-label="Voice call active"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "20px",
        padding: "16px 24px",
        margin: "16px 24px 0 24px",
        height: "auto",
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
      }}
    >
      {/* Left side: Status Indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <div 
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            background: "rgba(110, 231, 135, 0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-online)",
            flexShrink: 0,
          }}
        >
          <Activity size={24} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "16px", color: "var(--color-text-primary)" }}>
              Voice call live
            </span>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--color-online)" }} />
          </div>
          <span style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>
            {participants.length} in call • {formatDuration(callDuration)}
          </span>
        </div>
      </div>

      {/* Middle: Participant Previews (if any) */}
      {participants.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "24px", flex: 1, justifyContent: "center" }}>
          {participants.slice(0, 1).map((p) => (
            <div key={p.socketId} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ position: "relative" }}>
                <Avatar 
                  displayName={p.displayName} 
                  username={p.displayName} 
                  avatarColor={p.avatarColor} 
                  size="md" 
                />
                {p.isSpeaking && (
                  <span style={{
                    position: "absolute",
                    bottom: "-2px",
                    right: "-2px",
                    width: "12px",
                    height: "12px",
                    background: "var(--color-online)",
                    border: "2px solid var(--color-bg-elevated)",
                    borderRadius: "50%",
                  }} />
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
                  {p.displayName}
                  <Activity size={12} color="var(--color-online)" />
                </span>
                <span style={{ fontSize: "12px", color: "var(--color-online)" }}>Connected</span>
              </div>
            </div>
          ))}
          {participants.length > 1 && (
            <span style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>
              +{participants.length - 1} more
            </span>
          )}
        </div>
      )}

      {/* Right side: Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", position: "relative" }}>
        {showSettings && <VoiceSettings onClose={() => setShowSettings(false)} />}
        
        {!isInCall ? (
          <Button
            variant="primary"
            onClick={joinCall}
            style={{ borderRadius: "12px", background: "var(--color-lavender)" }}
          >
            <PhoneCall size={16} />
            Join Call
          </Button>
        ) : (
          <>
            <Button
              variant="icon"
              onClick={toggleMute}
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "12px",
                background: isMuted ? "rgba(255, 107, 120, 0.15)" : "var(--color-bg-subtle)",
                color: isMuted ? "var(--color-destructive)" : "var(--color-text-secondary)",
                border: "1px solid var(--color-border)",
              }}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </Button>
            
            <Button
              variant="icon"
              onClick={isScreensharing ? stopScreenshare : startScreenshare}
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "12px",
                background: isScreensharing ? "rgba(255, 107, 120, 0.15)" : "var(--color-bg-subtle)",
                color: isScreensharing ? "var(--color-destructive)" : "var(--color-text-secondary)",
                border: "1px solid var(--color-border)",
              }}
              title={isScreensharing ? "Stop screenshare" : "Start screenshare"}
            >
              {isScreensharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
            </Button>
            
            <Button
              variant="icon"
              onClick={() => setShowSettings(!showSettings)}
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "12px",
                background: "var(--color-bg-subtle)",
                border: "1px solid var(--color-border)",
              }}
              title="More options"
            >
              <MoreHorizontal size={18} />
            </Button>

            <Button
              variant="danger"
              onClick={leaveCall}
              style={{
                height: "40px",
                borderRadius: "12px",
                background: "rgba(255, 107, 120, 0.15)",
                color: "var(--color-destructive)",
                border: "1px solid rgba(255, 107, 120, 0.2)",
                padding: "0 16px",
                fontWeight: 600,
              }}
            >
              <PhoneOff size={16} />
              Leave call
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
