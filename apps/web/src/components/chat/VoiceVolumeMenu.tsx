import { useEffect, useRef } from "react";
import { useVoiceStore } from "../../stores/voiceStore.js";
import { Volume2, VolumeX } from "lucide-react";

interface VoiceVolumeMenuProps {
  x: number;
  y: number;
  userId: string;
  displayName: string;
  socketId: string;
  onClose: () => void;
}

export default function VoiceVolumeMenu({ x, y, userId, displayName, socketId, onClose }: VoiceVolumeMenuProps) {
  const { volumes, setVolume } = useVoiceStore();
  const menuRef = useRef<HTMLDivElement>(null);

  // Keep menu within screen boundaries
  const screenX = Math.max(10, Math.min(x, window.innerWidth - 220));
  const screenY = Math.max(10, Math.min(y, window.innerHeight - 140));

  // Read volume percentage from store (default is 100)
  const currentVolume = volumes[socketId] ?? 100;

  // Handle outside clicks to close the menu
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    
    // Slight delay to prevent immediate closing from the click that triggered the menu
    const timer = setTimeout(() => {
      document.addEventListener("click", handleOutsideClick);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [onClose]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setVolume(socketId, val);

    // Persist to localStorage by userId
    const saved = JSON.parse(localStorage.getItem("cozy_voice_user_volumes") || "{}");
    saved[userId] = val;
    localStorage.setItem("cozy_voice_user_volumes", JSON.stringify(saved));
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: `${screenY}px`,
        left: `${screenX}px`,
        transform: "translate(-50%, -100%)", // offset above click point
        marginTop: "-12px",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "16px",
        padding: "16px",
        boxShadow: "var(--shadow-lg)",
        zIndex: 2000,
        width: "200px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
        {displayName}'s Volume
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {currentVolume === 0 ? (
          <VolumeX size={16} color="var(--color-text-secondary)" />
        ) : (
          <Volume2 size={16} color="var(--color-text-secondary)" />
        )}
        <input
          type="range"
          min="0"
          max="200"
          value={currentVolume}
          onChange={handleVolumeChange}
          style={{
            flex: 1,
            accentColor: "var(--color-lavender)",
            height: "4px",
            background: "var(--color-bg-subtle)",
            borderRadius: "2px",
            outline: "none",
            cursor: "pointer",
          }}
        />
        <span style={{ fontSize: "12px", minWidth: "35px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>
          {currentVolume}%
        </span>
      </div>
    </div>
  );
}
