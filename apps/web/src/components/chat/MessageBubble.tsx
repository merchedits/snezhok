import { useRef, useState } from "react";
import Avatar from "../Avatar.jsx";
import FileCard from "../FileCard.jsx";
import ImagePreview from "../ImagePreview.jsx";
import Button from "../Button.jsx";
import { Message, useMessageStore } from "../../stores/messageStore.js";
import { useAuthStore } from "../../stores/authStore.js";
import { getSocket } from "../../lib/socket.js";
import { Heart, Trash2, Reply, Pencil, X, Check } from "lucide-react";

interface MessageBubbleProps {
  message: Message;
  isGroupStart: boolean;
}

export default function MessageBubble({ message, isGroupStart }: MessageBubbleProps) {
  const { user: currentUser } = useAuthStore();
  const setReplyingTo = useMessageStore((state) => state.setReplyingTo);
  const messages = useMessageStore((state) => state.messages);
  const touchTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const isOwn = message.userId === currentUser?.id;
  const isAdmin = currentUser?.isAdmin || false;

  // Heart reaction logic
  const heartReaction = message.reactions.find((r) => r.emoji === "❤️");
  const hasHearted = heartReaction?.userIds.includes(currentUser?.id || "") || false;

  const handleHeart = () => {
    const socket = getSocket();
    socket.emit("message:react", {
      messageId: message.id,
      emoji: "❤️",
      action: hasHearted ? "remove" : "add",
    });
  };

  const handleDelete = () => {
    const socket = getSocket();
    socket.emit("message:delete", { messageId: message.id });
  };

  const handleReply = () => {
    setReplyingTo(message);
  };

  const handleEditSubmit = () => {
    if (!editContent.trim() || editContent === message.content) {
      setIsEditing(false);
      return;
    }
    const socket = getSocket();
    socket.emit("message:edit", { messageId: message.id, content: editContent });
    setIsEditing(false);
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

  // Find replied-to message
  const replyMessage = message.replyToId
    ? messages.find((m) => m.id === message.replyToId)
    : null;

  if (message.type === "system") {
    return (
      <div className="time-divider" style={{ textTransform: "none", letterSpacing: "normal" }}>
        🌸 {message.user?.displayName || "Someone"} {message.content} • {formatTime(message.createdAt)}
      </div>
    );
  }

  return (
    <div
      id={`msg-${message.id}`}
      className="msg-group"
      style={{
        alignItems: isOwn ? "flex-end" : "flex-start",
        marginBottom: isGroupStart ? "14px" : "4px",
      }}
    >
      {!isOwn && isGroupStart && (
        <div className="msg-group-header" style={{ flexDirection: "row", marginBottom: "4px" }}>
          <Avatar
            displayName={message.user?.displayName}
            username={message.user?.username}
            avatarColor={message.user?.avatarColor}
            avatarUrl={message.user?.avatarUrl}
            size="sm"
          />
          <span className="msg-username">{message.user?.displayName}</span>
        </div>
      )}

      <div 
        className={isOwn ? "msg-row own" : "msg-row"} 
        style={{ position: "relative" }}
        onTouchStart={() => {
          touchTimerRef.current = setTimeout(() => {}, 500);
        }}
        onTouchEnd={() => {
          if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
        }}
        onTouchMove={() => {
          if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
        }}
      >
        {/* Message bubble content */}
        <div
          className={`bubble ${isOwn ? "own" : "other"}`}
          style={{
            // If it's a file, we want minimal padding or file card styling
            padding: message.fileId ? "4px" : undefined,
            background: message.fileId ? "transparent" : undefined,
            border: message.fileId ? "none" : undefined,
          }}
        >
          {/* Reply preview */}
          {replyMessage && (
            <div
              onClick={() => {
                const el = document.getElementById(`msg-${replyMessage.id}`);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  el.classList.add("highlight-msg");
                  setTimeout(() => el.classList.remove("highlight-msg"), 2000);
                }
              }}
              style={{
                borderLeft: "3px solid var(--color-peach)",
                paddingLeft: "10px",
                marginBottom: "8px",
                fontSize: "var(--text-sm)",
                color: "var(--color-text-secondary)",
                lineHeight: 1.4,
                maxHeight: "48px",
                overflow: "hidden",
                cursor: "pointer",
              }}
            >
              <strong style={{ color: "var(--color-peach-dark)", fontSize: "var(--text-sm)" }}>
                {replyMessage.user?.displayName}
              </strong>
              <div style={{ opacity: 0.8 }}>
                {replyMessage.content.length > 80
                  ? replyMessage.content.slice(0, 80) + "…"
                  : replyMessage.content}
              </div>
            </div>
          )}

          {message.fileId && message.file ? (
            message.file.mimeType.startsWith("image/") ? (
              <ImagePreview id={message.file.id} originalName={message.file.originalName} />
            ) : message.file.mimeType.startsWith("video/") ? (
              <div style={{
                marginTop: "6px",
                marginBottom: "6px",
                maxWidth: "100%",
                width: "480px",
                borderRadius: "16px",
                overflow: "hidden",
                border: "1px solid var(--color-border)",
                background: "#000",
                boxShadow: "var(--shadow-sm)",
                display: "flex",
                flexDirection: "column"
              }}>
                <video
                  src={`/api/files/${message.file.id}/${encodeURIComponent(message.file.originalName)}`}
                  controls
                  preload="metadata"
                  playsInline
                  style={{
                    width: "100%",
                    height: "auto",
                    maxHeight: "360px",
                    display: "block",
                    borderRadius: "16px"
                  }}
                />
              </div>
            ) : (
              <FileCard
                id={message.file.id}
                originalName={message.file.originalName}
                mimeType={message.file.mimeType}
                sizeBytes={message.file.sizeBytes}
              />
            )
          ) : isEditing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "200px" }}>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleEditSubmit();
                  }
                  if (e.key === "Escape") {
                    setIsEditing(false);
                    setEditContent(message.content);
                  }
                }}
                style={{
                  width: "100%",
                  background: "var(--color-bg-subtle)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  padding: "8px",
                  color: "var(--color-text-primary)",
                  fontFamily: "var(--font-body)",
                  fontSize: "var(--text-base)",
                  resize: "vertical",
                  minHeight: "60px",
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
                <Button variant="icon" onClick={() => { setIsEditing(false); setEditContent(message.content); }} style={{ width: "24px", height: "24px", background: "var(--color-bg-base)" }}>
                  <X size={14} />
                </Button>
                <Button variant="icon" onClick={handleEditSubmit} style={{ width: "24px", height: "24px", background: "var(--color-peach)", color: "#fff" }}>
                  <Check size={14} />
                </Button>
              </div>
            </div>
          ) : (
            <div>{renderMessageContent(message.content)}</div>
          )}
        </div>

        {/* Timestamp outside bubble */}
        <div style={{ 
          fontSize: "11px", 
          color: "var(--color-text-tertiary)", 
          display: "flex", 
          alignItems: "center", 
          gap: "4px",
          paddingBottom: "4px",
          userSelect: "none"
        }}>
          {message.editedAt && <span style={{ fontStyle: "italic", opacity: 0.7 }}>(edited)</span>}
          {formatTime(message.createdAt)}
          {isOwn && <span style={{ color: "var(--color-lavender)" }}>✓</span>}
        </div>

        {/* Action buttons on hover: heart, reply, delete */}
        <div
          className="reaction-trigger"
          style={{
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            [isOwn ? "left" : "right"]: "-110px",
            zIndex: 10,
            display: "flex",
            gap: "2px",
          }}
        >
          {/* Heart button */}
          <Button
            variant="icon"
            style={{
              width: "32px",
              height: "32px",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-bg-subtle)",
              color: hasHearted ? "#E8627A" : undefined,
            }}
            onClick={handleHeart}
            title="Heart"
          >
            <Heart size={15} fill={hasHearted ? "#E8627A" : "none"} />
          </Button>

          {/* Reply button */}
          <Button
            variant="icon"
            style={{
              width: "32px",
              height: "32px",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-bg-subtle)",
            }}
            onClick={handleReply}
            title="Reply"
          >
            <Reply size={15} />
          </Button>

          {/* Edit button (only for own messages and text messages) */}
          {isOwn && message.type === "text" && !message.fileId && (
            <Button
              variant="icon"
              style={{
                width: "32px",
                height: "32px",
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-bg-subtle)",
              }}
              onClick={() => { setIsEditing(true); setEditContent(message.content); }}
              title="Edit"
            >
              <Pencil size={15} />
            </Button>
          )}

          {/* Delete button (only for own messages or admin) */}
          {(isOwn || isAdmin) && (
            <Button
              variant="icon"
              style={{
                width: "32px",
                height: "32px",
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-bg-subtle)",
                color: "var(--color-destructive)",
              }}
              onClick={handleDelete}
              title="Delete message"
            >
              <Trash2 size={15} />
            </Button>
          )}
        </div>
      </div>

      {/* Render heart reactions if any exist */}
      {heartReaction && (
        <div
          className="reaction-row"
          style={{
            alignSelf: isOwn ? "flex-end" : "flex-start",
          }}
        >
          <div
            className={`reaction ${hasHearted ? "active" : ""}`}
            onClick={handleHeart}
          >
            <span>❤️</span>
          </div>
        </div>
      )}
    </div>
  );
}
