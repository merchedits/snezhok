import { useState, type FormEvent } from "react";
import { Check, Hash, Server, Users, Volume2 } from "lucide-react";
import type { Id } from "@snezhok/contracts";
import { api } from "../lib/api.js";
import { useApp } from "../state/AppContext.js";
import { Avatar, Dialog, EmptyState } from "./ui.js";

export function NewConversationDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [selected, setSelected] = useState<Set<Id>>(new Set());
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const friends = app.bootstrap?.friends.filter((entry) => entry.relationship === "friend") || [];
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected.size) return;
    setSaving(true);
    try {
      const result = await api.createConversation([...selected], selected.size > 1 ? title.trim() || undefined : undefined);
      await app.refreshBootstrap();
      app.selectStream({ kind: "conversation", id: result.conversationId });
      onClose();
    } catch (error) {
      app.announce(error instanceof Error ? error.message : "Conversation could not be created.");
    } finally { setSaving(false); }
  };
  return <Dialog title={selected.size > 1 ? "New group" : "New message"} onClose={onClose}><form className="create-dialog-body" onSubmit={create}>{friends.length === 0 ? <EmptyState icon={<Users />} text="Add a friend before starting a chat." /> : <div className="contact-picker">{friends.map((entry) => <label key={entry.user.id}><input type="checkbox" checked={selected.has(entry.user.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(entry.user.id); else next.delete(entry.user.id); return next; })} /><Avatar user={entry.user} size={36} /><span><strong>{entry.user.displayName}</strong><small>@{entry.user.username}</small></span>{selected.has(entry.user.id) && <Check />}</label>)}</div>}{selected.size > 1 && <label>Group name<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required /></label>}<footer><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={!selected.size || saving}>{saving ? "Creating..." : "Create"}</button></footer></form></Dialog>;
}

export function CreateServerDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try { const result = await api.createServer(name.trim()); await app.refreshBootstrap(); app.selectStream({ kind: "channel", id: result.channelId }); onClose(); }
    catch (error) { app.announce(error instanceof Error ? error.message : "Server could not be created."); }
    finally { setSaving(false); }
  };
  return <Dialog title="Create server" onClose={onClose}><form className="create-dialog-body" onSubmit={create}><Server className="create-dialog-icon" /><label>Server name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label><footer><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Creating..." : "Create server"}</button></footer></form></Dialog>;
}

export function CreateChannelDialog({ serverId, onClose }: { serverId: Id; onClose: () => void }) {
  const app = useApp();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
  const [saving, setSaving] = useState(false);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try { const result = await api.createChannel(serverId, { name: name.trim(), topic: topic.trim(), kind, categoryId: null }); await app.refreshBootstrap(); app.selectStream({ kind: "channel", id: result.channel.id }); onClose(); }
    catch (error) { app.announce(error instanceof Error ? error.message : "Channel could not be created."); }
    finally { setSaving(false); }
  };
  return <Dialog title="Create channel" onClose={onClose}><form className="create-dialog-body" onSubmit={create}><div className="channel-type-picker"><button type="button" className={kind === "text" ? "is-selected" : ""} onClick={() => setKind("text")}><Hash /> Text channel</button><button type="button" className={kind === "voice" ? "is-selected" : ""} onClick={() => setKind("voice")}><Volume2 /> Voice channel</button></div><label>Channel name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label><label>Topic<input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={1024} /></label><footer><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Creating..." : "Create channel"}</button></footer></form></Dialog>;
}
