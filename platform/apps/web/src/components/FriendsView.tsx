import { useMemo, useState, type FormEvent } from "react";
import { Check, Menu, MessageCircle, Search, UserRoundPlus, Users, X } from "lucide-react";
import type { FriendEntry } from "@snezhok/contracts";
import { api, RequestError } from "../lib/api.js";
import { useApp } from "../state/AppContext.js";
import { Avatar, EmptyState, IconButton } from "./ui.js";

type FriendTab = "all" | "online" | "requests";

export function FriendsView() {
  const app = useApp();
  const [tab, setTab] = useState<FriendTab>("all");
  const [query, setQuery] = useState("");
  const [username, setUsername] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const friends = app.bootstrap?.friends || [];

  const visible = useMemo(() => friends.filter((entry) => {
    if (tab === "all" && entry.relationship !== "friend") return false;
    if (tab === "online" && (entry.relationship !== "friend" || entry.user.presence === "offline")) return false;
    if (tab === "requests" && !["incoming", "outgoing"].includes(entry.relationship)) return false;
    return !query || entry.user.displayName.toLowerCase().includes(query.toLowerCase()) || entry.user.username.toLowerCase().includes(query.toLowerCase());
  }), [friends, query, tab]);

  const addFriend = async (event: FormEvent) => {
    event.preventDefault();
    setRequestError(null);
    try {
      const result = await api.sendFriendRequest(username);
      app.replaceFriend(result.entry);
      setUsername("");
      app.announce("Friend request sent.");
    } catch (error) {
      setRequestError(error instanceof RequestError ? error.message : "Request failed. Retry.");
    }
  };

  const respond = async (entry: FriendEntry, accept: boolean) => {
    if (!entry.requestId) return;
    if (entry.relationship === "outgoing") {
      await api.cancelFriendRequest(entry.requestId);
      app.removeFriendEntry(entry.user.id);
      return;
    }
    const result = await api.respondFriendRequest(entry.requestId, accept);
    if (accept) app.replaceFriend(result.entry); else app.removeFriendEntry(entry.user.id);
  };

  const message = async (entry: FriendEntry) => {
    const existing = app.bootstrap?.conversations.find((conversation) => conversation.kind === "direct" && conversation.participants.some((member) => member.id === entry.user.id));
    if (existing) return app.selectStream({ kind: "conversation", id: existing.id });
    const result = await api.createConversation([entry.user.id]);
    await app.refreshBootstrap();
    app.selectStream({ kind: "conversation", id: result.conversationId });
  };

  return (
    <section className="friends-view">
      <header className="content-header mobile-content-header"><IconButton label="Open navigation" className="mobile-only" onClick={() => app.setDrawerOpen(true)}><Menu /></IconButton><div className="header-title"><Users /><strong>Friends</strong></div></header>
      <div className="friends-toolbar">
        <div className="segmented-tabs" role="tablist" aria-label="Friend filters">
          <button role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>All</button>
          <button role="tab" aria-selected={tab === "online"} onClick={() => setTab("online")}>Online</button>
          <button role="tab" aria-selected={tab === "requests"} onClick={() => setTab("requests")}>Requests</button>
        </div>
        <form className="add-friend" onSubmit={addFriend}>
          <UserRoundPlus />
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Add by username" aria-label="Username" required />
          <button className="button button-primary">Send request</button>
        </form>
        {requestError && <p className="form-error" role="alert">{requestError}</p>}
        <label className="list-filter"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search friends" /></label>
      </div>
      <div className="friend-list">
        {visible.length === 0 ? <EmptyState icon={<Users />} text={tab === "requests" ? "No pending friend requests." : "No friends found."} /> : visible.map((entry) => (
          <div className="friend-row" key={entry.user.id}>
            <Avatar user={entry.user} presence={entry.user.presence} size={44} />
            <span className="row-copy"><strong>{entry.user.displayName}</strong><small>@{entry.user.username} · {entry.relationship === "friend" ? entry.user.presence : entry.relationship}</small></span>
            {entry.relationship === "friend" && <IconButton label="Message" onClick={() => void message(entry)}><MessageCircle /></IconButton>}
            {entry.relationship === "incoming" && <><IconButton label="Accept" onClick={() => void respond(entry, true)}><Check /></IconButton><IconButton label="Decline" onClick={() => void respond(entry, false)}><X /></IconButton></>}
            {entry.relationship === "outgoing" && <button className="button button-secondary" onClick={() => void respond(entry, false)}>Cancel</button>}
          </div>
        ))}
      </div>
    </section>
  );
}
