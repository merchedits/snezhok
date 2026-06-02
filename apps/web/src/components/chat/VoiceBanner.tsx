import { useState, useEffect } from "react";
import { Mic, MicOff, PhoneOff, PhoneCall, Monitor, MonitorOff, MoreHorizontal, Activity, ChevronDown, ChevronUp } from "lucide-react";
import Button from "../Button.jsx";
import { useVoiceStore } from "../../stores/voiceStore.js";
import { useVoice } from "../../hooks/useVoice.js";
import VoiceSettings from "./VoiceSettings.jsx";
import Avatar from "../Avatar.jsx";
import { useTranslation } from "../../i18n/index.jsx";
import VoiceVolumeMenu from "./VoiceVolumeMenu.jsx";
import { useAuthStore } from "../../stores/authStore.js";

export default function VoiceBanner() {
  const { participants, isInCall, isMuted, diagnostics } = useVoiceStore();
  const {
    joinCall,
    leaveCall,
    toggleMute,
    startScreenshare,
    stopScreenshare,
    playLocalTestTone,
    sendTestTone,
    requestVoiceDiagnostics,
    isScreensharing,
  } = useVoice();
  const { t } = useTranslation();
  const { user: currentUser } = useAuthStore();
  const [showSettings, setShowSettings] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    userId: string;
    displayName: string;
    socketId: string;
  } | null>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
      aria-label={t('voice.callLive')}
      onClick={() => setExpanded(!expanded)}
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "20px",
        padding: "16px 24px",
        margin: "16px 24px 0 24px",
        height: "auto",
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
    >
      {/* Top Row: Information & Controls */}
      <div style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "center",
        justifyContent: "space-between",
        width: "100%",
        gap: isMobile ? "12px" : "16px",
      }}>
        {/* Left side: Status Indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1 }}>
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
                {t('voice.callLive')}
              </span>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--color-online)" }} />
            </div>
            <span style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>
              {participants.length} {t('voice.inCall')} • {formatDuration(callDuration)}
              {diagnostics.pingMs !== null ? ` • ${diagnostics.pingMs} ms` : ""}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", marginLeft: "8px" }}>
            {expanded ? <ChevronUp size={20} color="var(--color-text-tertiary)" /> : <ChevronDown size={20} color="var(--color-text-tertiary)" />}
          </div>
        </div>

        {/* Right side: Controls */}
        <div 
          onClick={(e) => e.stopPropagation()} // Prevent collapsing banner when clicking buttons
          style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: "12px", 
            position: "relative",
            justifyContent: isMobile ? "flex-end" : "flex-start",
          }}
        >
          {showSettings && (
            <VoiceSettings
              onClose={() => setShowSettings(false)}
              onPlayLocalTestTone={playLocalTestTone}
              onSendTestTone={sendTestTone}
              onRequestDiagnostics={requestVoiceDiagnostics}
              isAdmin={!!currentUser?.isAdmin}
            />
          )}
          
          {!isInCall ? (
            <Button
              variant="primary"
              onClick={(e) => { e.stopPropagation(); joinCall(); }}
              style={{ borderRadius: "12px", background: "var(--color-lavender)", display: "flex", alignItems: "center", gap: "8px" }}
            >
              <PhoneCall size={16} />
              {t('voice.joinCall')}
            </Button>
          ) : (
            <>
              <Button
                variant="icon"
                onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "12px",
                  background: isMuted ? "rgba(255, 107, 120, 0.15)" : "var(--color-bg-subtle)",
                  color: isMuted ? "var(--color-destructive)" : "var(--color-text-secondary)",
                  border: "1px solid var(--color-border)",
                }}
                title={isMuted ? t('voice.unmute') : t('voice.mute')}
              >
                {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
              </Button>
              
              <Button
                variant="icon"
                onClick={(e) => { e.stopPropagation(); isScreensharing ? stopScreenshare() : startScreenshare(); }}
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "12px",
                  background: isScreensharing ? "rgba(255, 107, 120, 0.15)" : "var(--color-bg-subtle)",
                  color: isScreensharing ? "var(--color-destructive)" : "var(--color-text-secondary)",
                  border: "1px solid var(--color-border)",
                }}
                title={isScreensharing ? t('voice.stopScreenshare') : t('voice.startScreenshare')}
              >
                {isScreensharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
              </Button>
              
              <Button
                variant="icon"
                onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }}
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "12px",
                  background: "var(--color-bg-subtle)",
                  border: "1px solid var(--color-border)",
                }}
                title={t('voice.moreOptions')}
              >
                <MoreHorizontal size={18} />
              </Button>

              <Button
                variant="danger"
                onClick={(e) => { e.stopPropagation(); leaveCall(); }}
                style={{
                  height: "40px",
                  borderRadius: "12px",
                  background: "rgba(255, 107, 120, 0.15)",
                  color: "var(--color-destructive)",
                  border: "1px solid rgba(255, 107, 120, 0.2)",
                  padding: "0 16px",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <PhoneOff size={16} />
                {t('voice.leaveCall')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Expanded Participant List */}
      {expanded && participants.length > 0 && (
        <div 
          onClick={(e) => e.stopPropagation()} // Prevent toggling when clicking participant container
          style={{
            width: "100%",
            borderTop: "1px solid var(--color-border)",
            marginTop: "16px",
            paddingTop: "16px",
            display: "flex",
            flexDirection: "row",
            flexWrap: "wrap",
            gap: "20px",
            justifyContent: "center",
          }}
        >
          {participants.map((p) => (
            <div 
              key={p.socketId}
              onContextMenu={(e) => {
                if (p.userId === currentUser?.id) return;
                e.preventDefault();
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  userId: p.userId,
                  displayName: p.displayName,
                  socketId: p.socketId
                });
              }}
              title={p.userId === currentUser?.id ? undefined : "Right click to adjust volume"}
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
                cursor: p.userId === currentUser?.id ? "default" : "context-menu",
                border: p.isSpeaking ? "2px solid var(--color-online)" : "2px solid transparent",
                transition: "border 0.2s ease"
              }}
            >
              <Avatar 
                displayName={p.displayName} 
                username={p.displayName} 
                avatarColor={p.avatarColor} 
                avatarUrl={p.avatarUrl || undefined}
                size="lg" 
                isSpeaking={p.isSpeaking}
              />
              
              <div style={{ position: "absolute", top: "32px", right: "24px" }}>
                <Activity size={16} color={p.isSpeaking ? "var(--color-online)" : "var(--color-text-tertiary)"} />
              </div>

              <div style={{ textAlign: "center" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "4px" }}>
                  {p.displayName}
                </h3>
                <p style={{ fontSize: "13px", color: p.isSpeaking ? "var(--color-online)" : "var(--color-text-secondary)", marginBottom: "4px" }}>
                  {t('voice.inVoiceCall')}
                </p>
                <p style={{ fontSize: "13px", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
                  {formatDuration(callDuration)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      
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
