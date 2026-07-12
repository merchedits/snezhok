import { useEffect, useState } from "react";
import { Pin, X } from "lucide-react";
import type { Message } from "@snezhok/contracts";
import { api } from "../lib/api.js";
import { useApp } from "../state/AppContext.js";
import { Avatar, EmptyState, IconButton, Spinner, formatDay } from "./ui.js";

export function PinsDrawer() {
  const app = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!app.selection) return;
    setLoading(true);
    api.pinned(app.selection.kind, app.selection.id).then((result) => setMessages(result.messages)).catch(() => app.announce("Pinned messages could not be loaded.")).finally(() => setLoading(false));
  }, [app.selection?.id, app.selection?.kind]);

  return <aside className="pins-drawer"><header><strong>Pinned messages</strong><IconButton label="Close pinned messages" onClick={() => app.setPinsOpen(false)}><X /></IconButton></header><div className="pins-list">{loading ? <Spinner /> : messages.length === 0 ? <EmptyState icon={<Pin />} text="No pinned messages." /> : messages.map((message) => <button key={message.id} className="pin-row"><Avatar user={message.sender} size={32} /><span><strong>{message.sender.displayName}</strong><small>{message.text || message.kind}</small></span><time>{formatDay(message.createdAt)}</time></button>)}</div></aside>;
}
