interface AvatarProps {
  displayName?: string;
  username?: string;
  avatarColor?: string;
  avatarUrl?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  showOnline?: boolean;
  isOnline?: boolean;
  isSpeaking?: boolean;
}

export default function Avatar({
  displayName,
  username,
  avatarColor = "#FFCFB3",
  avatarUrl,
  size = "md",
  className = "",
  showOnline = false,
  isOnline = false,
  isSpeaking = false,
}: AvatarProps) {
  const name = displayName || username || "?";
  
  // Extract initials
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  const sizeClass = `avatar-${size}`;

  // Determine presence dot class
  let presenceClass = "presence-offline";
  if (isSpeaking) {
    presenceClass = "presence-speaking";
  } else if (isOnline) {
    presenceClass = "presence-online";
  }

  return (
    <div style={{ position: "relative", display: "inline-flex" }} className={className}>
      <div
        className={`avatar ${sizeClass}`}
        style={{
          backgroundColor: avatarColor,
          backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          color: avatarUrl ? "transparent" : undefined
        }}
        title={name}
      >
        {initials}
      </div>
      {showOnline && (
        <div
          className={`presence-dot ${presenceClass}`}
          style={{
            position: "absolute",
            bottom: size === "lg" ? "2px" : "0px",
            right: size === "lg" ? "2px" : "0px",
            border: "2px solid var(--color-bg-surface)",
          }}
          title={isSpeaking ? "Speaking" : isOnline ? "Online" : "Offline"}
        />
      )}
    </div>
  );
}
