import { useState, useRef } from "react";
import Avatar from "../Avatar.jsx";
import FileCard from "../FileCard.jsx";
import ImagePreview from "../ImagePreview.jsx";
import Button from "../Button.jsx";
import { Message } from "../../stores/messageStore.js";
import { useAuthStore } from "../../stores/authStore.js";
import { getSocket } from "../../lib/socket.js";
import { Smile } from "lucide-react";

interface MessageBubbleProps {
  message: Message;
  isGroupStart: boolean;
}

const QUICK_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🎉"];

export default function MessageBubble({ message, isGroupStart }: MessageBubbleProps) {
  const { user: currentUser } = useAuthStore();
  const [showPicker, setShowPicker] = useState(false);
  const touchTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isOwn = message.userId === currentUser?.id;

  const handleReact = (emoji: string) => {
    const socket = getSocket();
    const hasReacted = message.reactions
      .find((r) => r.emoji === emoji)
      ?.userIds.includes(currentUser?.id || "");

    socket.emit("message:react", {
      messageId: message.id,
      emoji,
      action: hasReacted ? "remove" : "add",
    });
    setShowPicker(false);
  };

  // Format message time
  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  // Parse links and wrap codes
  const renderMessageContent = (content: string) => {
    // Escape HTML tags to prevent XSS
    const safeContent = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Regex for inline code `code`
    const parts = safeContent.split(/(`[^`]+`)/g);
    return parts.map((part, index) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={index}>{part.slice(1, -1)}</code>;
      }
      
      // Basic link detection
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const subparts = part.split(urlRegex);
      return subparts.map((subpart, subIndex) => {
        if (subpart.match(urlRegex)) {
          return (
            <a
              key={`${index}-${subIndex}`}
              href={subpart}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-peach-dark)", textDecoration: "underline" }}
            >
              {subpart}
            </a>
          );
        }
        return subpart;
      });
    });
  };

  if (message.type === "system") {
    return (
      <div className="sys-msg">
        🌸 <strong>{message.user?.displayName || "Someone"}</strong> {message.content}
      </div>
    );
  }

  return (
    <div
      className="msg-group"
      style={{
        alignItems: isOwn ? "flex-end" : "flex-start",
        marginBottom: isGroupStart ? "12px" : "3px",
      }}
    >
      {isGroupStart && (
        <div className="msg-group-header" style={{ flexDirection: isOwn ? "row-reverse" : "row" }}>
          <Avatar
            displayName={message.user?.displayName}
            username={message.user?.username}
            avatarColor={message.user?.avatarColor}
            size="sm"
          />
          <span className="msg-username">{isOwn ? "You" : message.user?.displayName}</span>
          <span className="msg-time">{formatTime(message.createdAt)}</span>
        </div>
      )}

      <div 
        className={isOwn ? "msg-row own" : "msg-row"} 
        style={{ position: "relative" }}
        onTouchStart={() => {
          touchTimerRef.current = setTimeout(() => setShowPicker(true), 500);
        }}
        onTouchEnd={() => {
          if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
        }}
        onTouchMove={() => {
          if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
        }}
      >
        {/* Placeholder avatar spacing for group messages to indent them */}
        {!isGroupStart && (
          <div style={{ width: "32px", height: "1px", flexShrink: 0 }} />
        )}

        {/* Message bubble content */}
        <div
          className={`bubble ${isOwn ? "own" : "other"}`}
          style={{
            // If it's a file, we want minimal padding or file card styling
            padding: message.fileId ? "4px" : "10px 14px",
            background: message.fileId ? "transparent" : undefined,
            border: message.fileId ? "none" : undefined,
          }}
        >
          {message.fileId && message.file ? (
            message.file.mimeType.startsWith("image/") ? (
              <ImagePreview id={message.file.id} originalName={message.file.originalName} />
            ) : (
              <FileCard
                id={message.file.id}
                originalName={message.file.originalName}
                mimeType={message.file.mimeType}
                sizeBytes={message.file.sizeBytes}
              />
            )
          ) : (
            <div>{renderMessageContent(message.content)}</div>
          )}
        </div>

        {/* Reaction picker trigger on hover or long-press */}
        <div
          className={`reaction-trigger ${showPicker ? "active" : ""}`}
          style={{
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            [isOwn ? "left" : "right"]: "-40px",
            zIndex: 10,
          }}
        >
          <Button
            variant="icon"
            style={{ width: "28px", height: "28px", background: "var(--color-bg-elevated)", border: "1px solid var(--color-bg-subtle)" }}
            onClick={() => setShowPicker(!showPicker)}
            title="Add reaction"
          >
            <Smile size={14} />
          </Button>

          {showPicker && (
            <div
              style={{
                position: "absolute",
                top: "-36px",
                [isOwn ? "left" : "right"]: "0px",
                display: "flex",
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-bg-subtle)",
                borderRadius: "20px",
                padding: "2px 6px",
                gap: "4px",
                boxShadow: "0 4px 12px rgba(60,40,25,0.08)",
                zIndex: 20,
              }}
            >
              {QUICK_EMOJIS.map((emoji) => (
                <span
                  key={emoji}
                  onClick={() => handleReact(emoji)}
                  style={{ cursor: "pointer", fontSize: "14px", padding: "2px" }}
                >
                  {emoji}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Render reactions row if any exist */}
      {message.reactions && message.reactions.length > 0 && (
        <div
          className="reaction-row"
          style={{
            alignSelf: isOwn ? "flex-end" : "flex-start",
            paddingLeft: isOwn ? "0px" : "40px",
            paddingRight: isOwn ? "40px" : "0px",
          }}
        >
          {message.reactions.map((react) => {
            const hasReacted = react.userIds.includes(currentUser?.id || "");
            return (
              <div
                key={react.emoji}
                className={`reaction ${hasReacted ? "active" : ""}`}
                onClick={() => handleReact(react.emoji)}
              >
                <span>{react.emoji}</span>
                <span>{react.count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
