import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Forward,
  Hash,
  Info,
  Menu,
  MessageCircleReply,
  MoreHorizontal,
  Pencil,
  Phone,
  Pin,
  Play,
  Search,
  SmilePlus,
  Trash2,
  Users,
  Video,
  Volume2,
} from "lucide-react";
import type { Attachment, Message, MessagePreview, ReactionSummary, UserSummary } from "@snezhok/contracts";
import { useApp } from "../state/AppContext.js";
import { useCall } from "../state/CallContext.js";
import { formatBytes } from "../lib/media.js";
import { api } from "../lib/api.js";
import { Avatar, EmptyState, IconButton, Spinner, formatDay, formatTime } from "./ui.js";
import { Dialog } from "./ui.js";
import { Composer } from "./Composer.js";
import { SearchDialog } from "./SearchDialog.js";
import { PinsDrawer } from "./PinsDrawer.js";

export function ChatView() {
  const app = useApp();
  const call = useCall();
  const data = app.bootstrap!;
  const selection = app.selection;
  if (!selection) return <EmptyState icon={<MessageCircleReply />} text="No conversation selected." />;

  const conversation = selection.kind === "conversation" ? data.conversations.find((item) => item.id === selection.id) : undefined;
  const channel = selection.kind === "channel" ? data.channels.find((item) => item.id === selection.id) : undefined;
  if (channel?.kind === "voice") return <VoiceChannelView />;

  const title = conversation?.title || channel?.name || "Conversation";
  const other = conversation?.kind === "direct" ? conversation.participants.find((member) => member.id !== data.me.id) : undefined;
  const subtitle = other ? presenceText(other) : channel?.topic || (conversation?.kind === "group" ? `${conversation.participants.length} members` : "");

  return (
    <section className="chat-view">
      <header className="content-header">
        <IconButton label="Open navigation" className="mobile-only" onClick={() => app.setDrawerOpen(true)}><Menu /></IconButton>
        <div className="header-title">
          {channel ? <Hash /> : <Avatar user={other} name={title} url={conversation?.avatarUrl} size={32} presence={other?.presence} />}
          <span><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
        </div>
        <div className="header-actions">
          {conversation && <><IconButton label="Start voice call" onClick={() => void call.join(conversation.id, title)}><Phone /></IconButton><IconButton label="Start video call" onClick={() => void call.join(conversation.id, title, { video: true })}><Video /></IconButton></>}
          <IconButton label="Pinned messages" active={app.pinsOpen} onClick={() => app.setPinsOpen(!app.pinsOpen)}><Pin /></IconButton>
          <IconButton label="Search" onClick={() => app.setSearchOpen(true)}><Search /></IconButton>
          <IconButton label="Conversation information" active={app.infoOpen} onClick={() => app.setInfoOpen(!app.infoOpen)}><Info /></IconButton>
        </div>
      </header>
      <div className="chat-content-row">
        <div className="message-column">
          <MessageList serverMode={selection.kind === "channel"} />
          <TypingLine />
          <Composer />
        </div>
        {app.infoOpen && <InfoDrawer title={title} members={conversation?.participants || []} topic={channel?.topic || ""} />}
        {app.pinsOpen && <PinsDrawer />}
      </div>
      {app.searchOpen && <SearchDialog />}
    </section>
  );
}

function TypingLine() {
  const app = useApp();
  if (!app.typingUserIds.length) return <div className="typing-line" aria-live="polite" />;
  const known = [
    ...(app.bootstrap?.friends.map((entry) => entry.user) || []),
    ...(app.bootstrap?.conversations.flatMap((conversation) => conversation.participants) || []),
  ];
  const names = app.typingUserIds.map((id) => known.find((user) => user.id === id)?.displayName).filter(Boolean);
  return <div className="typing-line" aria-live="polite"><span><i /><i /><i /></span>{names.length === 1 ? `${names[0]} is typing` : names.length > 1 ? `${names.slice(0, 2).join(" and ")} are typing` : "Someone is typing"}</div>;
}

function MessageList({ serverMode }: { serverMode: boolean }) {
  const app = useApp();
  const bottomRef = useRef<HTMLDivElement>(null);
  const previousCount = useRef(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const grew = app.messages.length > previousCount.current;
    previousCount.current = app.messages.length;
    if (grew) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [app.messages.length]);

  if (app.loadingMessages && app.messages.length === 0) return <div className="message-loading"><Spinner label="Loading messages" /></div>;
  if (app.messages.length === 0) return <div className="message-list"><EmptyState icon={<MessageCircleReply />} text="No messages yet." /><div ref={bottomRef} /></div>;

  return (
    <div className={`message-list ${serverMode ? "server-message-list" : "bubble-message-list"}`} role="log" aria-live="polite" aria-relevant="additions">
      {app.hasOlderMessages && <button className="load-older" onClick={() => void app.loadOlder()} disabled={app.loadingMessages}>{app.loadingMessages ? "Loading..." : "Load older messages"}</button>}
      {app.messages.map((message, index) => {
        const previous = app.messages[index - 1];
        const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
        const grouped = serverMode && Boolean(previous && previous.sender.id === message.sender.id && message.createdAt - previous.createdAt < 300_000 && !newDay);
        return (
          <Fragment key={message.id}>
            {newDay && <div className="date-separator"><span>{formatDay(message.createdAt)}</span></div>}
            <MessageRow message={message} serverMode={serverMode} grouped={grouped} selected={selectedId === message.id} onSelected={() => setSelectedId(selectedId === message.id ? null : message.id)} />
          </Fragment>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

function MessageRow({ message, serverMode, grouped, selected, onSelected }: { message: Message; serverMode: boolean; grouped: boolean; selected: boolean; onSelected: () => void }) {
  const app = useApp();
  const mine = message.sender.id === app.me?.id;
  const deleted = Boolean(message.deletedAt);

  if (message.kind === "system") return <div className="system-message">{message.text}</div>;

  const content = (
    <>
      {message.replyTo && <ReplyReference preview={message.replyTo} />}
      {deleted ? <p className="deleted-message">Message deleted</p> : <>
        {message.text && <p className="message-text">{message.text}</p>}
        {message.attachments.length > 0 && <AttachmentGrid attachments={message.attachments} kind={message.kind} />}
      </>}
      <div className="message-meta"><time>{formatTime(message.createdAt)}</time>{message.editedAt && <span>edited</span>}{message.pending && <span aria-label="Sending">◷</span>}{message.failed && <button onClick={() => void app.retryMessage(message)}>Retry</button>}{!message.pending && !message.failed && mine && <Check aria-label="Sent" />}</div>
      {message.reactions.length > 0 && <div className="reaction-row">{message.reactions.map((reaction) => <Reaction key={reaction.emoji} message={message} reaction={reaction} />)}</div>}
    </>
  );

  return (
    <article className={`${serverMode ? "channel-message" : "bubble-row"} ${mine ? "is-mine" : ""} ${grouped ? "is-grouped" : ""} ${selected ? "is-selected" : ""}`} onContextMenu={(event) => { event.preventDefault(); onSelected(); }}>
      {serverMode ? <>
        {!grouped ? <Avatar user={message.sender} size={40} /> : <time className="grouped-time">{formatTime(message.createdAt)}</time>}
        <div className="channel-message-body">{!grouped && <div className="author-line"><strong>{message.sender.displayName}</strong><time>{formatTime(message.createdAt)}</time></div>}{content}</div>
      </> : <>
        {!mine && <Avatar user={message.sender} size={32} />}
        <div className="bubble-wrap">{!mine && <strong className="bubble-author">{message.sender.displayName}</strong>}<div className="message-bubble">{content}</div></div>
      </>}
      {!deleted && <MessageActions message={message} mine={mine} visible={selected} onClose={onSelected} />}
    </article>
  );
}

function MessageActions({ message, mine, visible, onClose }: { message: Message; mine: boolean; visible: boolean; onClose: () => void }) {
  const app = useApp();
  const [more, setMore] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  return (
    <div className={`message-actions ${visible ? "is-open" : ""}`}>
      <IconButton label="Reply" onClick={() => { app.setReplyingTo(message); onClose(); }}><MessageCircleReply /></IconButton>
      <IconButton label="React" onClick={() => void app.reactToMessage(message, "👍")}><SmilePlus /></IconButton>
      <IconButton label="Copy" onClick={() => { void navigator.clipboard.writeText(message.text); app.announce("Message copied."); onClose(); }}><Copy /></IconButton>
      {mine && <IconButton label="Edit" onClick={() => { app.setEditing(message); onClose(); }}><Pencil /></IconButton>}
      <IconButton label={message.pinnedAt ? "Unpin" : "Pin"} active={Boolean(message.pinnedAt)} onClick={() => { void app.togglePin(message); onClose(); }}><Pin /></IconButton>
      <IconButton label="Forward" onClick={() => setForwardOpen(true)}><Forward /></IconButton>
      <IconButton label="More" onClick={() => setMore(!more)}><MoreHorizontal /></IconButton>
      {more && <div className="action-menu">
        {mine && <button className="danger-text" onClick={() => { if (window.confirm("Delete this message for everyone?")) void app.deleteMessage(message); onClose(); }}><Trash2 /> Delete message</button>}
      </div>}
      {forwardOpen && <ForwardDialog message={message} onClose={() => { setForwardOpen(false); onClose(); }} />}
    </div>
  );
}

function ForwardDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const app = useApp();
  const data = app.bootstrap!;
  const [sending, setSending] = useState(false);
  const forward = async (target: { kind: "conversation" | "channel"; id: string }) => {
    setSending(true);
    try {
      await api.sendMessage(target.kind, target.id, { clientId: crypto.randomUUID(), text: message.text, kind: message.kind, replyToId: null, attachmentIds: message.attachments.map((item) => item.id) });
      app.announce("Message forwarded.");
      onClose();
    } catch (error) { app.announce(error instanceof Error ? error.message : "Message could not be forwarded."); }
    finally { setSending(false); }
  };
  return <Dialog title="Forward message" onClose={onClose}><div className="forward-list">{data.conversations.filter((item) => !item.archived).map((conversation) => <button key={conversation.id} disabled={sending} onClick={() => void forward({ kind: "conversation", id: conversation.id })}><MessageCircleReply /><span><strong>{conversation.title}</strong><small>Chat</small></span></button>)}{data.channels.filter((channel) => channel.kind === "text").map((channel) => <button key={channel.id} disabled={sending} onClick={() => void forward({ kind: "channel", id: channel.id })}><Hash /><span><strong>{channel.name}</strong><small>Text channel</small></span></button>)}</div></Dialog>;
}

function Reaction({ message, reaction }: { message: Message; reaction: ReactionSummary }) {
  const app = useApp();
  return <button className={`reaction ${reaction.reacted ? "is-reacted" : ""}`} aria-pressed={reaction.reacted} onClick={() => void app.reactToMessage(message, reaction.emoji)}><span>{reaction.emoji}</span>{reaction.count}</button>;
}

function ReplyReference({ preview }: { preview: MessagePreview }) {
  return <button className="reply-reference"><strong>{preview.senderName}</strong><span>{preview.text || preview.kind}</span></button>;
}

function AttachmentGrid({ attachments, kind }: { attachments: Attachment[]; kind: Message["kind"] }) {
  if (kind === "voice") return <VoiceNote attachment={attachments[0]} />;
  if (kind === "video-note") return <VideoNote attachment={attachments[0]} />;
  return (
    <div className={`attachment-grid attachment-count-${Math.min(attachments.length, 4)}`}>
      {attachments.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment} />)}
    </div>
  );
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  if (attachment.kind === "image") return <a className="media-attachment" href={attachment.url} target="_blank" rel="noreferrer"><img src={attachment.thumbnailUrl || attachment.url} alt={attachment.filename} loading="lazy" /></a>;
  if (attachment.kind === "video") return <video className="media-attachment" src={attachment.url} poster={attachment.thumbnailUrl || undefined} controls preload="metadata" />;
  if (attachment.kind === "audio") return <audio src={attachment.url} controls preload="metadata" />;
  return <a className="file-attachment" href={attachment.url} download={attachment.filename}><FileText /><span><strong>{attachment.filename}</strong><small>{formatBytes(attachment.bytes)}</small></span><Download /></a>;
}

function VoiceNote({ attachment }: { attachment?: Attachment | undefined }) {
  const [speed, setSpeed] = useState(1);
  if (!attachment) return null;
  return <div className="voice-note"><button aria-label="Play voice note"><Play /></button><div className="waveform" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <i key={index} style={{ height: `${8 + ((index * 11) % 20)}px` }} />)}</div><audio src={attachment.url} preload="metadata" /><button className="speed-button" onClick={() => setSpeed(speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1)}>{speed}x</button></div>;
}

function VideoNote({ attachment }: { attachment?: Attachment | undefined }) {
  if (!attachment) return null;
  return <video className="video-note" src={attachment.url} poster={attachment.thumbnailUrl || undefined} controls playsInline preload="metadata" />;
}

function InfoDrawer({ title, members, topic }: { title: string; members: UserSummary[]; topic: string }) {
  const app = useApp();
  return <aside className="info-drawer"><header><strong>Details</strong><IconButton label="Close details" onClick={() => app.setInfoOpen(false)}><ChevronDown /></IconButton></header><div className="info-identity"><Avatar name={title} size={72} /><h2>{title}</h2>{topic && <p>{topic}</p>}</div>{members.length > 0 && <section><h3>{members.length} members</h3>{members.map((member) => <div className="member-row" key={member.id}><Avatar user={member} size={36} presence={member.presence} /><span><strong>{member.displayName}</strong><small>{member.statusText || `@${member.username}`}</small></span></div>)}</section>}</aside>;
}

function VoiceChannelView() {
  const app = useApp();
  const call = useCall();
  const channel = app.bootstrap!.channels.find((item) => item.id === app.selection?.id);
  if (!channel) return null;
  return (
    <section className="voice-channel-view">
      <header className="content-header"><IconButton label="Open navigation" className="mobile-only" onClick={() => app.setDrawerOpen(true)}><Menu /></IconButton><div className="header-title"><Volume2 /><span><strong>{channel.name}</strong><small>{channel.topic}</small></span></div><IconButton label="Channel information" onClick={() => app.setInfoOpen(!app.infoOpen)}><Info /></IconButton></header>
      <div className="voice-channel-content">
        <Volume2 className="voice-channel-icon" />
        <h1>{channel.name}</h1>
        <p>{channel.connectedMembers.length ? `${channel.connectedMembers.length} connected` : "No one is connected to this voice channel."}</p>
        <div className="voice-preview-members">{channel.connectedMembers.map((member) => <div key={member.id}><Avatar user={member} size={48} /><strong>{member.displayName}</strong></div>)}</div>
        <button className="button button-primary" onClick={() => void call.join(channel.id, channel.name)}>{call.roomId === channel.id ? "Return to voice" : "Join voice"}</button>
      </div>
    </section>
  );
}

function presenceText(user: UserSummary) {
  if (user.statusText) return user.statusText;
  if (user.presence === "online") return "Online";
  if (user.presence === "idle") return "Idle";
  if (user.presence === "do-not-disturb") return "Do not disturb";
  return "Offline";
}
