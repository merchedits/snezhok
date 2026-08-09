import { useEffect, useState, type FormEvent } from "react";
import { FileText, MessageCircle, Search, UserRound } from "lucide-react";
import type { Message } from "@snezhok/contracts";
import { isUserVisibleStreamKind, productCapabilities } from "../config/productCapabilities.js";
import { api, type MessageSearchResult } from "../lib/api.js";
import { useApp } from "../state/AppContext.js";
import { Avatar, Dialog, EmptyState, Spinner, formatTime } from "./ui.js";

export function SearchDialog() {
  const app = useApp();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"" | "messages" | "media" | "files" | "links">("");
  const [results, setResults] = useState<MessageSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.search(query.trim(), scope ? { scope } : {});
      setResults({
        ...result,
        messages: result.messages.filter((message) => isUserVisibleStreamKind(message.streamKind)),
        files: productCapabilities.servers ? result.files : [],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed. Retry.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = query.trim().length >= 3 ? window.setTimeout(() => void run(), 320) : null;
    return () => { if (timer) window.clearTimeout(timer); };
    // Search is deliberately debounced from query and scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope]);

  const openMessage = (message: Message) => {
    app.selectStream({ kind: message.streamKind, id: message.streamId });
    app.setSearchOpen(false);
  };

  const openPerson = (userId: string) => {
    const direct = app.bootstrap?.conversations.find((conversation) => conversation.kind === "direct" && conversation.participants.some((participant) => participant.id === userId));
    if (direct) app.selectStream({ kind: "conversation", id: direct.id });
    else app.showFriends();
    app.setSearchOpen(false);
  };

  const empty = results && !results.messages.length && !results.people.length && !results.files.length;

  return (
    <Dialog title="Search" onClose={() => app.setSearchOpen(false)} className="search-dialog">
      <form className="search-form" onSubmit={run}>
        <label><Search /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages, people, and files" aria-label="Search query" /></label>
        <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} aria-label="Search scope"><option value="">All</option><option value="messages">Messages</option><option value="media">Media</option><option value="files">Files</option><option value="links">Links</option></select>
      </form>
      <div className="search-results">
        {loading && <div className="search-loading"><Spinner /></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!loading && !results && <EmptyState icon={<Search />} text="Search messages, people, and files." />}
        {empty && <EmptyState icon={<Search />} text="No results found." />}
        {results?.people.length ? <section><h3>People</h3>{results.people.map((person) => <button className="search-result" key={person.id} onClick={() => openPerson(person.id)}><Avatar user={person} size={36} /><span><strong>{person.displayName}</strong><small>@{person.username}</small></span></button>)}</section> : null}
        {results?.messages.length ? <section><h3>Messages</h3>{results.messages.map((message) => <button className="search-result" key={message.id} onClick={() => openMessage(message)}><MessageCircle /><span><strong>{message.sender.displayName}</strong><small>{message.text || message.kind}</small></span><time>{formatTime(message.createdAt)}</time></button>)}</section> : null}
        {results?.files.length ? <section><h3>Files</h3>{results.files.map((file) => <a className="search-result" key={file.id} href={file.url} target="_blank" rel="noreferrer"><FileText /><span><strong>{file.filename}</strong><small>{file.mimeType || file.kind}</small></span></a>)}</section> : null}
      </div>
    </Dialog>
  );
}
