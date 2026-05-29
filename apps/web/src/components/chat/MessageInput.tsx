import React, { useState, useRef, useEffect } from "react";
import { Paperclip, Smile, Send, Loader2, X, RefreshCw } from "lucide-react";
import Button from "../Button.jsx";
import { getSocket } from "../../lib/socket.js";
import { useMessageStore } from "../../stores/messageStore.js";
import { useTranslation } from "../../i18n/index.jsx";

const QUICK_EMOJIS = ["🌸", "🫶", "✨", "👋", "🌙", "🌊", "❤️", "👍"];
const CHUNK_SIZE = 1024 * 1024; // 1MB

export interface UploadJob {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "error" | "done";
  error: string | null;
  abortController: AbortController | null;
}

export default function MessageInput() {
  const [content, setContent] = useState("");
  const { t } = useTranslation();
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const replyingTo = useMessageStore((state) => state.replyingTo);
  const clearReplyingTo = useMessageStore((state) => state.clearReplyingTo);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);
  const processingRef = useRef(false);

  // Resize input box based on content lines
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`; // Cap max height at 180px
  }, [content]);

  // Clean up typing timeouts
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  const handleSend = () => {
    if (!content.trim()) return;

    const socket = getSocket();
    socket.emit("message:send", {
      content: content.trim(),
      type: "text",
      replyToId: replyingTo?.id || undefined,
    });

    setContent("");
    clearReplyingTo();
    stopTyping();

    // Focus input again
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Typing state handlers
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    startTyping();
  };

  const startTyping = () => {
    const socket = getSocket();
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit("typing:start");
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, 2000); // 2 second typing timeout
  };

  const stopTyping = () => {
    if (isTypingRef.current) {
      isTypingRef.current = false;
      const socket = getSocket();
      socket.emit("typing:stop");
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  // File Upload Handlers
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    addFilesToQueue(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addFilesToQueue = (files: File[]) => {
    const newJobs: UploadJob[] = files.map((file) => ({
      id: Math.random().toString(36).substring(2),
      file,
      progress: 0,
      status: "pending",
      error: null,
      abortController: null,
    }));
    setUploads((prev) => [...prev, ...newJobs]);
  };

  useEffect(() => {
    const processQueue = async () => {
      if (processingRef.current) return;
      const nextJob = uploads.find((u) => u.status === "pending");
      if (!nextJob) return;

      processingRef.current = true;
      await uploadJob(nextJob);
      processingRef.current = false;
    };
    processQueue();
  }, [uploads]);

  const uploadJob = async (job: UploadJob) => {
    const abortController = new AbortController();
    setUploads((prev) =>
      prev.map((u) => (u.id === job.id ? { ...u, status: "uploading", abortController, error: null } : u))
    );

    try {
      const initRes = await fetch("/api/files/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalName: job.file.name,
          mimeType: job.file.type || "application/octet-stream",
          totalSize: job.file.size,
        }),
        signal: abortController.signal,
      });

      if (!initRes.ok) {
        const errorData = await initRes.json().catch(() => ({}));
        throw new Error(errorData.error || "Initialization failed");
      }
      
      const { fileId } = await initRes.json();
      const totalChunks = Math.max(1, Math.ceil(job.file.size / CHUNK_SIZE));

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, job.file.size);
        const chunk = job.file.slice(start, end);

        let attempt = 0;
        let success = false;
        while (attempt < 3 && !success) {
          try {
            const formData = new FormData();
            formData.append("fileId", fileId);
            formData.append("chunkIndex", chunkIndex.toString());
            formData.append("chunk", chunk);

            const chunkRes = await fetch("/api/files/upload/chunk", {
              method: "POST",
              body: formData,
              signal: abortController.signal,
            });

            if (!chunkRes.ok) {
              const errorData = await chunkRes.json().catch(() => ({}));
              throw new Error(errorData.error || `Chunk ${chunkIndex} failed`);
            }
            success = true;
          } catch (err: any) {
            if (err.name === "AbortError") throw err;
            attempt++;
            if (attempt >= 3) throw err;
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        }

        setUploads((prev) =>
          prev.map((u) =>
            u.id === job.id ? { ...u, progress: Math.round(((chunkIndex + 1) / totalChunks) * 100) } : u
          )
        );
      }

      const compRes = await fetch("/api/files/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, finalSize: job.file.size }),
        signal: abortController.signal,
      });

      if (!compRes.ok) {
        const errorData = await compRes.json().catch(() => ({}));
        throw new Error(errorData.error || "Completion failed");
      }
      
      const { file: finalFile } = await compRes.json();

      const socket = getSocket();
      socket.emit("message:send", {
        content: finalFile.originalName,
        type: "file",
        fileId: finalFile.id,
      });

      setUploads((prev) =>
        prev.map((u) => (u.id === job.id ? { ...u, status: "done", progress: 100 } : u))
      );

      setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.id !== job.id));
      }, 2000);
    } catch (err: any) {
      if (err.name === "AbortError") {
        setUploads((prev) => prev.filter((u) => u.id !== job.id));
      } else {
        setUploads((prev) =>
          prev.map((u) => (u.id === job.id ? { ...u, status: "error", error: err.message || "Upload failed" } : u))
        );
      }
    }
  };

  const cancelUpload = (jobId: string) => {
    const job = uploads.find((u) => u.id === jobId);
    if (job?.abortController) {
      job.abortController.abort();
    } else {
      setUploads((prev) => prev.filter((u) => u.id !== jobId));
    }
  };

  const retryUpload = (jobId: string) => {
    setUploads((prev) =>
      prev.map((u) => (u.id === jobId ? { ...u, status: "pending", error: null, progress: 0 } : u))
    );
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Use target checking to avoid flickering with children
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(Array.from(e.dataTransfer.files));
    }
  };

  // Emoji Click Handler
  const handleEmojiClick = (emoji: string) => {
    setContent((prev) => prev + emoji);
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  };

  return (
    <div 
      style={{ 
        display: "flex", 
        flexDirection: "column", 
        width: "100%", 
        position: "relative",
        border: isDragging ? "2px dashed var(--color-peach)" : "none",
        borderRadius: "16px",
        padding: isDragging ? "2px" : "0",
        transition: "all 0.2s"
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Upload Progress Banner(s) */}
      {uploads.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "var(--color-bg-subtle)", borderTop: "1px solid rgba(168, 151, 140, 0.1)", borderBottom: "1px solid rgba(168, 151, 140, 0.1)" }}>
          {uploads.map((job) => (
            <div
              key={job.id}
              style={{
                padding: "var(--space-2) var(--space-4)",
                background: "var(--color-bg-subtle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: "var(--text-sm)",
              }}
            >
              {(job.status === "uploading" || job.status === "pending" || job.status === "done") ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                  {job.status === "done" ? (
                    <span style={{ color: "var(--color-green)", fontSize: "14px" }}>✓</span>
                  ) : (
                    <Loader2 size={14} className="spin" style={{ animation: "spin 1s linear infinite" }} />
                  )}
                  <span style={{ color: "var(--color-text-secondary)", flexShrink: 0, maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {job.file.name}
                  </span>
                  <span style={{ color: "var(--color-text-tertiary)", minWidth: "30px" }}>
                    ({job.progress}%)
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: "4px",
                      background: "var(--color-bg-base)",
                      borderRadius: "2px",
                      overflow: "hidden",
                      marginLeft: "12px",
                    }}
                  >
                    <div
                      style={{
                        width: `${job.progress}%`,
                        height: "100%",
                        background: job.status === "done" ? "var(--color-green)" : "var(--color-peach)",
                        transition: "width 100ms ease",
                      }}
                    />
                  </div>
                  <Button variant="icon" onClick={() => cancelUpload(job.id)} style={{ width: "24px", height: "24px", marginLeft: "8px" }} aria-label="Cancel upload">
                    <X size={12} />
                  </Button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                  <span style={{ color: "var(--color-destructive)", maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {job.file.name}: {job.error}
                  </span>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <Button variant="icon" onClick={() => retryUpload(job.id)} style={{ width: "24px", height: "24px" }} aria-label="Retry upload">
                      <RefreshCw size={12} />
                    </Button>
                    <Button variant="icon" onClick={() => cancelUpload(job.id)} style={{ width: "24px", height: "24px" }} aria-label="Cancel upload">
                      <X size={12} />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: "none" }}
      />

      <div className="message-input-inner">
        {/* Reply Preview Bar */}
        {replyingTo && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "8px 12px",
              marginBottom: "12px",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "12px",
              fontSize: "13px",
              width: "100%",
            }}
          >
            <div
              style={{
                borderLeft: "3px solid var(--color-lavender)",
                paddingLeft: "12px",
                flex: 1,
                overflow: "hidden",
              }}
            >
              <div style={{ fontWeight: 600, color: "var(--color-lavender)", fontSize: "13px" }}>
                {replyingTo.user?.displayName}
              </div>
              <div
                style={{
                  color: "var(--color-text-secondary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {replyingTo.content.length > 60 ? replyingTo.content.slice(0, 60) + "…" : replyingTo.content}
              </div>
            </div>
            <Button
              variant="icon"
              onClick={clearReplyingTo}
              style={{ width: "24px", height: "24px", flexShrink: 0 }}
              aria-label="Cancel reply"
            >
              <X size={14} />
            </Button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", width: "100%" }}>
          <div className="input-area" style={{ margin: 0, flex: 1, minWidth: 0, display: "flex", alignItems: "flex-end", background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", borderRadius: "24px", padding: "4px" }}>
            <div className="input-left" style={{ paddingLeft: "8px", paddingBottom: "4px" }}>
              {/* Attach File Button */}
              <button
                className="composer-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploads.some(u => u.status === "uploading")}
                aria-label="Attach file"
              >
                <Paperclip size={20} strokeWidth={2} />
              </button>
            </div>

            {/* Text Box */}
            <textarea
              ref={textareaRef}
              className="input-box"
              rows={1}
              value={content}
              onChange={handleInputChange}
              placeholder={t('chat.messagePlaceholder')}
              onKeyDown={handleKeyDown}
              onBlur={stopTyping}
              aria-label="Message input"
              style={{ minHeight: "44px", padding: "10px 12px", fontSize: "15px" }}
            />

            <div className="send-btn-container" style={{ paddingRight: "8px", paddingBottom: "4px", position: "relative" }}>
              {/* Quick Emoji Picker Button */}
              <button
                className="composer-btn"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                aria-label="Add emoji"
              >
                <Smile size={20} strokeWidth={2} />
              </button>

              {showEmojiPicker && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "48px",
                    right: "0",
                    display: "flex",
                    flexWrap: "wrap",
                    background: "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border-strong)",
                    borderRadius: "16px",
                    padding: "8px",
                    gap: "6px",
                    width: "180px",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
                    zIndex: 40,
                  }}
                >
                  {QUICK_EMOJIS.map((emoji) => (
                    <span
                      key={emoji}
                      onClick={() => handleEmojiClick(emoji)}
                      style={{
                        cursor: "pointer",
                        fontSize: "20px",
                        padding: "6px",
                        borderRadius: "8px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "background 0.2s",
                      }}
                      className="quick-emoji-picker-item"
                    >
                      {emoji}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Detached Send Button */}
          <button
            className="send-btn-round"
            onClick={handleSend}
            disabled={!content.trim() || uploads.some(u => u.status === "uploading")}
            aria-label="Send message"
            style={{ flexShrink: 0, marginBottom: "4px", width: "44px", height: "44px" }}
          >
            <Send size={18} strokeWidth={2.5} style={{ marginLeft: "2px" }} />
          </button>
        </div>
      </div>
    </div>
  );
}
