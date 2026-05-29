import { useState } from "react";
import { Mic, MicOff, PhoneOff, PhoneCall, Settings, Monitor, MonitorOff } from "lucide-react";
import Button from "../Button.jsx";
import { useVoiceStore } from "../../stores/voiceStore.js";
import { useVoice } from "../../hooks/useVoice.js";
import VoiceSettings from "./VoiceSettings.jsx";

export default function VoiceBanner() {
  const { participants, isInCall, isMuted } = useVoiceStore();
  const { joinCall, leaveCall, toggleMute, startScreenshare, stopScreenshare, isScreensharing } = useVoice();
  const [showSettings, setShowSettings] = useState(false);

  if (participants.length === 0) return null;

  // List participant display names
  const participantNames = participants.map((p) => p.displayName).join(", ");

  return (
    <div className="voice-banner" role="status" aria-label="Voice call active">
      <div className="voice-ring">
        <PhoneCall size={14} />
      </div>
      <div className="voice-label">
        Voice call active <span>· {participantNames}</span>
      </div>

      <div className="voice-avatars">
        {participants.slice(0, 3).map((p) => (
          <div
            key={p.socketId}
            className="voice-avatar-chip"
            style={{
              backgroundColor: p.avatarColor,
              boxShadow: p.isSpeaking ? "0 0 0 3px var(--color-lavender)" : undefined,
              animation: p.isSpeaking ? "voicePulse 1.4s infinite" : undefined,
            }}
            title={p.displayName}
          >
            {p.displayName.slice(0, 2).toUpperCase()}
          </div>
        ))}
        {participants.length > 3 && (
          <div
            className="voice-avatar-chip"
            style={{ backgroundColor: "var(--color-bg-subtle)" }}
          >
            +{participants.length - 3}
          </div>
        )}
      </div>

      {isInCall ? (
        <div style={{ display: "flex", gap: "6px", position: "relative" }}>
          {showSettings && <VoiceSettings onClose={() => setShowSettings(false)} />}
          
          <Button
            variant="ghost"
            onClick={() => setShowSettings(!showSettings)}
            style={{ height: "30px", padding: "0 var(--space-2)" }}
            aria-label="Voice settings"
          >
            <Settings size={14} />
          </Button>

          <Button
            variant="ghost"
            onClick={toggleMute}
            className="voice-btn mute"
            style={{ height: "30px", fontSize: "var(--text-sm)", padding: "0 var(--space-3)" }}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
          >
            {isMuted ? <MicOff size={12} /> : <Mic size={12} />}
            {isMuted ? "Unmute" : "Mute"}
          </Button>
          
          <Button
            variant="ghost"
            onClick={isScreensharing ? stopScreenshare : startScreenshare}
            style={{ height: "30px", fontSize: "var(--text-sm)", padding: "0 var(--space-3)", color: isScreensharing ? "var(--color-destructive)" : undefined }}
            aria-label={isScreensharing ? "Stop screenshare" : "Start screenshare"}
          >
            {isScreensharing ? <MonitorOff size={12} /> : <Monitor size={12} />}
            {isScreensharing ? "Stop" : "Share"}
          </Button>

          <Button
            variant="danger"
            onClick={leaveCall}
            style={{ height: "30px", fontSize: "var(--text-sm)", padding: "0 var(--space-3)" }}
            aria-label="Leave voice call"
          >
            <PhoneOff size={12} />
            Leave
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          onClick={joinCall}
          className="voice-btn join"
          style={{ height: "30px", fontSize: "var(--text-sm)", padding: "0 var(--space-3)" }}
          aria-label="Join voice call"
        >
          <PhoneCall size={12} />
          Join
        </Button>
      )}
    </div>
  );
}
