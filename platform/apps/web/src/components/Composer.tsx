import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { FileText, Image, Loader2, Paperclip, RefreshCw, Send, Smile, X } from "lucide-react";
import type { Attachment, MessageKind, UploadQuality } from "@snezhok/contracts";
import { api } from "../lib/api.js";
import { attachmentKind, createObjectUrl, formatBytes, prepareMedia } from "../lib/media.js";
import { loadDraft, saveDraft } from "../lib/offlineStore.js";
import { getRealtimeSocket } from "../lib/realtime.js";
import { useApp } from "../state/AppContext.js";
import { IconButton } from "./ui.js";
import { RecordControl } from "./Recorder.js";

interface AttachmentDraft {
  id: string;
  file: File;
  kind: Attachment["kind"];
  preview: string | null;
  quality: UploadQuality;
  progress: number;
  status: "ready" | "processing" | "uploading" | "failed";
  error: string | null;
}

const EMOJI = ["😀", "😂", "🥰", "👍", "❤️", "🎉", "🔥", "👀", "🙏", "🤝", "✨", "😢", "😮", "😡", "✅", "❄️"];

export function Composer() {
  const app = useApp();
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<AttachmentDraft[]>([]);
  const [quality, setQuality] = useState<UploadQuality>(app.bootstrap?.settings.defaultUploadQuality || "auto");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<number | null>(null);
  const draftKey = useRef<string | null>(null);
  const draftGeneration = useRef(0);
  const draftDirty = useRef(false);
  const draftReady = useRef(false);
  const selection = app.selection;

  useEffect(() => {
    if (!app.editing) return;
    setText(app.editing.text);
    textarea.current?.focus();
  }, [app.editing]);

  useEffect(() => {
    let active = true;
    const generation = ++draftGeneration.current;
    const key = selection ? `${selection.kind}:${selection.id}` : null;
    draftKey.current = key;
    draftDirty.current = false;
    draftReady.current = false;
    setText("");
    if (key) void loadDraft(key).then((value) => {
      if (!active || generation !== draftGeneration.current || draftDirty.current) return;
      setText(value);
      draftReady.current = true;
    }); else draftReady.current = true;
    setDrafts((current) => {
      current.forEach((draft) => { if (draft.preview) URL.revokeObjectURL(draft.preview); });
      return [];
    });
    return () => { active = false; };
  }, [selection?.id, selection?.kind]);

  useEffect(() => {
    if (!app.editing && draftKey.current && draftReady.current) void saveDraft(draftKey.current, text);
  }, [app.editing, text]);

  useEffect(() => () => {
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    if (selection) getRealtimeSocket().emit("typing:set", { streamId: selection.id, typing: false });
  }, [selection]);

  const canSend = Boolean(text.trim() || drafts.length) && !sending;

  const addFiles = (files: File[]) => {
    const next = files.slice(0, Math.max(0, 10 - drafts.length)).map((file): AttachmentDraft => {
      const kind = attachmentKind(file);
      return {
        id: crypto.randomUUID(),
        file,
        kind,
        preview: kind === "image" || kind === "video" ? createObjectUrl(file).url : null,
        quality: kind === "document" ? "original" : quality,
        progress: 0,
        status: "ready",
        error: null,
      };
    });
    setDrafts((current) => [...current, ...next]);
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files || []));
    event.target.value = "";
  };

  const removeDraft = (id: string) => {
    setDrafts((current) => {
      const found = current.find((draft) => draft.id === id);
      if (found?.preview) URL.revokeObjectURL(found.preview);
      return current.filter((draft) => draft.id !== id);
    });
  };

  const updateDraft = (id: string, patch: Partial<AttachmentDraft>) => {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  };

  const uploadDraft = async (draft: AttachmentDraft): Promise<Attachment> => {
    updateDraft(draft.id, { status: "processing", progress: 0, error: null });
    const prepared = await prepareMedia(draft.file, draft.quality);
    updateDraft(draft.id, { status: "uploading" });
    try {
      return await api.upload({
        file: prepared,
        kind: draft.kind,
        quality: draft.quality,
        stripLocation: app.bootstrap?.settings.stripMediaLocation ?? true,
        onProgress: (progress) => updateDraft(draft.id, { progress }),
      });
    } catch (error) {
      updateDraft(draft.id, { status: "failed", error: error instanceof Error ? error.message : "Upload failed." });
      throw error;
    }
  };

  const restoreDraft = async () => {
    const key = draftKey.current;
    const generation = ++draftGeneration.current;
    draftDirty.current = false;
    draftReady.current = false;
    const value = key ? await loadDraft(key) : "";
    if (generation !== draftGeneration.current || draftDirty.current || draftKey.current !== key) return;
    setText(value);
    draftReady.current = true;
  };

  const submit = async () => {
    if (!canSend) return;
    if (app.editing) {
      if (text.trim()) await app.editMessage(app.editing, text.trim());
      await restoreDraft();
      return;
    }
    setSending(true);
    try {
      const attachments = await Promise.all(drafts.map(uploadDraft));
      let kind: MessageKind = "text";
      if (attachments.length) kind = attachments.some((attachment) => ["image", "video"].includes(attachment.kind)) ? "media" : "file";
      await app.sendMessage({ text: text.trim(), kind, attachments });
      drafts.forEach((draft) => { if (draft.preview) URL.revokeObjectURL(draft.preview); });
      setDrafts([]);
      setText("");
      if (draftKey.current) void saveDraft(draftKey.current, "");
      setEmojiOpen(false);
      textarea.current?.focus();
    } catch {
      app.announce("Upload failed. Retry.");
    } finally {
      setSending(false);
    }
  };

  const onText = (value: string) => {
    draftDirty.current = true;
    draftReady.current = true;
    setText(value);
    if (!selection) return;
    const socket = getRealtimeSocket();
    socket.emit("typing:set", { streamId: selection.id, typing: Boolean(value) });
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => socket.emit("typing:set", { streamId: selection.id, typing: false }), 1800);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && (app.editing || app.replyingTo)) {
      const wasEditing = Boolean(app.editing);
      app.setEditing(null);
      app.setReplyingTo(null);
      setText(wasEditing && draftKey.current ? "" : text);
      if (wasEditing && draftKey.current) {
        void restoreDraft();
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const recorded = async (file: File, kind: "voice" | "video-note") => {
    setSending(true);
    try {
      const attachment = await api.upload({
        file,
        kind: kind === "voice" ? "audio" : "video",
        purpose: kind,
        quality: "original",
        stripLocation: true,
      });
      await app.sendMessage({ text: "", kind, attachments: [attachment] });
    } catch {
      app.announce("Recording upload failed. Retry.");
    } finally {
      setSending(false);
    }
  };

  const qualityOptions: { value: UploadQuality; label: string }[] = [
    { value: "data-saver", label: "Data saver" },
    { value: "auto", label: "Auto" },
    { value: "high", label: "High quality" },
    { value: "original", label: "Original / file" },
  ];

  return (
    <div className="composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }}>
      {(app.replyingTo || app.editing) && <div className="composer-context">
        <span><strong>{app.editing ? "Editing message" : `Replying to ${app.replyingTo?.sender.displayName}`}</strong><small>{app.editing?.text || app.replyingTo?.text}</small></span>
        <IconButton label="Cancel" onClick={() => { const wasEditing = Boolean(app.editing); app.setEditing(null); app.setReplyingTo(null); if (wasEditing) void restoreDraft(); }}><X /></IconButton>
      </div>}

      {drafts.length > 0 && <div className="attachment-tray">
        <div className="attachment-tray-heading">
          <strong>{drafts.length} {drafts.length === 1 ? "attachment" : "attachments"}</strong>
          <label>Quality<select value={quality} onChange={(event) => {
            const next = event.target.value as UploadQuality;
            setQuality(next);
            setDrafts((current) => current.map((draft) => draft.kind === "document" ? draft : { ...draft, quality: next }));
          }}>{qualityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
        <div className="attachment-drafts">{drafts.map((draft) => <div className={`attachment-draft is-${draft.status}`} key={draft.id}>
          <div className="draft-preview">{draft.preview ? draft.kind === "image" ? <img src={draft.preview} alt="" /> : <video src={draft.preview} /> : draft.kind === "document" ? <FileText /> : <Image />}</div>
          <span><strong>{draft.file.name}</strong><small>{formatBytes(draft.file.size)} · {draft.quality}</small>{draft.status !== "ready" && <progress max={100} value={draft.progress} />}{draft.error && <small className="error-text">{draft.error}</small>}</span>
          {draft.status === "failed" ? <IconButton label="Retry" onClick={() => updateDraft(draft.id, { status: "ready", error: null })}><RefreshCw /></IconButton> : <IconButton label="Remove attachment" onClick={() => removeDraft(draft.id)}><X /></IconButton>}
        </div>)}</div>
      </div>}

      <div className="composer-row">
        <input ref={fileInput} type="file" multiple hidden onChange={handleFiles} />
        <IconButton label="Attach files" onClick={() => fileInput.current?.click()} disabled={sending}><Paperclip /></IconButton>
        <textarea ref={textarea} rows={1} value={text} onChange={(event) => onText(event.target.value)} onKeyDown={onKeyDown} placeholder="Message" aria-label="Message" maxLength={16_000} />
        <div className="emoji-anchor">
          <IconButton label="Emoji" active={emojiOpen} onClick={() => setEmojiOpen(!emojiOpen)}><Smile /></IconButton>
          {emojiOpen && <div className="emoji-picker" role="dialog" aria-label="Emoji"><header><strong>Recent</strong></header><div>{EMOJI.map((emoji) => <button key={emoji} onClick={() => { onText(text + emoji); textarea.current?.focus(); }}>{emoji}</button>)}</div></div>}
        </div>
        {canSend ? <IconButton label="Send message" className="send-button" disabled={sending} onClick={() => void submit()}>{sending ? <Loader2 className="spin" /> : <Send />}</IconButton> : <RecordControl disabled={sending} onRecorded={recorded} />}
      </div>
    </div>
  );
}
