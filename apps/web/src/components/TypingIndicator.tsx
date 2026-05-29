import { usePresenceStore } from "../stores/presenceStore.js";

export default function TypingIndicator() {
  const typingUserIds = usePresenceStore((state) => state.typingUserIds);
  const usersList = usePresenceStore((state) => state.usersList);

  if (typingUserIds.length === 0) return null;

  // Resolve user display names
  const typingNames = typingUserIds
    .map((id) => {
      const user = usersList.find((u) => u.id === id);
      return user ? user.displayName : null;
    })
    .filter(Boolean) as string[];

  if (typingNames.length === 0) return null;

  let text = "";
  if (typingNames.length === 1) {
    text = `${typingNames[0]} is typing...`;
  } else if (typingNames.length === 2) {
    text = `${typingNames[0]} and ${typingNames[1]} are typing...`;
  } else {
    text = "Several people are typing...";
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "var(--text-xs)",
        color: "var(--color-text-secondary)",
        padding: "0 var(--space-4) var(--space-2)",
        fontStyle: "italic",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ display: "flex", gap: "2px" }} aria-hidden="true">
        <span className="dot-typing" style={{ animation: "skeletonPulse 1.2s infinite 0ms" }}>•</span>
        <span className="dot-typing" style={{ animation: "skeletonPulse 1.2s infinite 200ms" }}>•</span>
        <span className="dot-typing" style={{ animation: "skeletonPulse 1.2s infinite 400ms" }}>•</span>
      </div>
      <span>{text}</span>
    </div>
  );
}
