import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Hash,
  Home,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  Settings,
  UserRoundPlus,
  Users,
  Volume2,
} from "lucide-react";
import type { ChannelSummary, Id, ServerSummary } from "@snezhok/contracts";
import { productCapabilities } from "../config/productCapabilities.js";
import { useApp } from "../state/AppContext.js";
import { useCall } from "../state/CallContext.js";
import { Avatar, IconButton } from "./ui.js";
import { CreateChannelDialog, CreateServerDialog, NewConversationDialog } from "./CreateDialogs.js";

export function Navigation() {
  const app = useApp();
  const data = app.bootstrap;
  const selectStream = app.selectStream;
  const selectedChannel = data?.channels.find((channel) => app.selection?.kind === "channel" && channel.id === app.selection.id);
  const [serverId, setServerId] = useState<Id | null>(selectedChannel?.serverId || null);
  const [createServerOpen, setCreateServerOpen] = useState(false);

  useEffect(() => {
    if (!productCapabilities.servers) {
      setServerId(null);
      if (app.selection?.kind === "channel") {
        const conversation = data?.conversations.find((item) => !item.archived) ?? data?.conversations[0];
        if (conversation) selectStream({ kind: "conversation", id: conversation.id });
      }
    } else if (selectedChannel) setServerId(selectedChannel.serverId);
    else if (app.selection?.kind === "conversation") setServerId(null);
  }, [app.selection?.kind, data?.conversations, selectStream, selectedChannel?.serverId]);

  if (!data) return null;

  const chooseHome = () => {
    setServerId(null);
    const currentConversation = app.selection?.kind === "conversation";
    if (!currentConversation && data.conversations[0]) app.selectStream({ kind: "conversation", id: data.conversations[0].id });
  };

  const chooseServer = (server: ServerSummary) => {
    setServerId(server.id);
    const currentBelongs = app.selection?.kind === "channel" && data.channels.some((channel) => channel.id === app.selection?.id && channel.serverId === server.id);
    if (!currentBelongs) {
      const first = data.channels.filter((channel) => channel.serverId === server.id).sort((a, b) => a.position - b.position)[0];
      if (first) app.selectStream({ kind: "channel", id: first.id });
    }
  };

  return (
    <div className={`navigation-shell ${app.drawerOpen ? "is-open" : ""}`}>
      <div className="mobile-drawer-scrim" onClick={() => app.setDrawerOpen(false)} aria-hidden="true" />
      {productCapabilities.servers ? <nav className="server-rail" aria-label="Servers">
        <button className={`server-button home-button ${serverId === null ? "is-selected" : ""}`} onClick={chooseHome} aria-label="Home" title="Home"><Home /></button>
        <div className="rail-rule" />
        <div className="server-list">
          {[...data.servers].sort((a, b) => a.position - b.position).map((server) => (
            <button key={server.id} className={`server-button ${serverId === server.id ? "is-selected" : ""} ${server.unread ? "has-unread" : ""}`} onClick={() => chooseServer(server)} aria-label={server.name} title={server.name}>
              {server.iconUrl ? <img src={server.iconUrl} alt="" /> : server.name.slice(0, 2).toUpperCase()}
              {server.mentionCount > 0 && <span className="badge">{server.mentionCount > 99 ? "99+" : server.mentionCount}</span>}
            </button>
          ))}
        </div>
        <button className="server-button add-server" aria-label="Add server" title="Add server" onClick={() => setCreateServerOpen(true)}><Plus /></button>
      </nav> : null}

      {productCapabilities.servers && serverId ? <ServerSidebar serverId={serverId} /> : <HomeSidebar />}
      {productCapabilities.servers && createServerOpen ? <CreateServerDialog onClose={() => setCreateServerOpen(false)} /> : null}
    </div>
  );
}

function HomeSidebar() {
  const app = useApp();
  const data = app.bootstrap!;
  const [query, setQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const conversations = useMemo(() => data.conversations
    .filter((conversation) => !conversation.archived && (!query || conversation.title.toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt), [data.conversations, query]);
  const requests = data.friends.filter((friend) => friend.relationship === "incoming").length;

  return (
    <aside className="context-sidebar" aria-label="Chats navigation">
      <div className="sidebar-search">
        <Search aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => undefined} placeholder="Search chats" aria-label="Search chats" />
        <IconButton label="Search messages" onClick={() => app.setSearchOpen(true)}><Search /></IconButton>
      </div>
      <nav className="primary-links">
        <button className={app.view === "friends" ? "is-selected" : ""} onClick={app.showFriends}><Users /> Friends</button>
        <button onClick={app.showFriends}><UserRoundPlus /> Requests {requests > 0 && <span className="badge">{requests}</span>}</button>
      </nav>
      <div className="section-heading"><span>Chats</span><IconButton label="New chat" onClick={() => setNewChatOpen(true)}><Plus /></IconButton></div>
      <div className="chat-list">
        {conversations.map((conversation) => {
          const selected = app.selection?.kind === "conversation" && app.selection.id === conversation.id && app.view === "stream";
          const other = conversation.participants.find((user) => user.id !== data.me.id);
          return (
            <button key={conversation.id} className={`chat-row ${selected ? "is-selected" : ""} ${conversation.muted ? "is-muted" : ""}`} onClick={() => app.selectStream({ kind: "conversation", id: conversation.id })}>
              <Avatar user={other} name={conversation.title} url={conversation.avatarUrl} size={40} presence={conversation.kind === "direct" ? other?.presence : undefined} />
              <span className="row-copy"><strong>{conversation.title}</strong><small>{conversation.lastMessage ? `${conversation.lastMessage.senderId === data.me.id ? "You: " : ""}${conversation.lastMessage.text || conversation.lastMessage.kind}` : "No messages yet."}</small></span>
              <span className="row-meta">{conversation.unreadCount > 0 && <i className="badge">{conversation.unreadCount}</i>}</span>
            </button>
          );
        })}
      </div>
      <AccountFooter />
      {newChatOpen && <NewConversationDialog onClose={() => setNewChatOpen(false)} />}
    </aside>
  );
}

function ServerSidebar({ serverId }: { serverId: Id }) {
  const app = useApp();
  const call = useCall();
  const data = app.bootstrap!;
  const server = data.servers.find((item) => item.id === serverId);
  const categories = data.categories.filter((category) => category.serverId === serverId).sort((a, b) => a.position - b.position);
  const looseChannels = data.channels.filter((channel) => channel.serverId === serverId && !channel.categoryId).sort((a, b) => a.position - b.position);
  const [collapsed, setCollapsed] = useState<Set<Id>>(new Set(categories.filter((category) => category.collapsed).map((category) => category.id)));
  const [serverMenu, setServerMenu] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);

  const channelRow = (channel: ChannelSummary) => {
    const selected = app.selection?.kind === "channel" && app.selection.id === channel.id;
    return (
      <button key={channel.id} className={`channel-row ${selected ? "is-selected" : ""} ${channel.unreadCount > 0 ? "has-unread" : ""}`} onClick={() => app.selectStream({ kind: "channel", id: channel.id })}>
        {channel.kind === "text" ? <Hash /> : <Volume2 />}
        <span>{channel.name}</span>
        {channel.mentionCount > 0 && <i className="badge">{channel.mentionCount}</i>}
        {channel.kind === "voice" && channel.connectedMembers.length > 0 && <small>{channel.connectedMembers.length}</small>}
      </button>
    );
  };

  return (
    <aside className="context-sidebar server-sidebar" aria-label={`${server?.name || "Server"} channels`}>
      <div className="server-header-wrap"><button className="server-header" aria-expanded={serverMenu} onClick={() => setServerMenu(!serverMenu)}><strong>{server?.name || "Server"}</strong><ChevronDown /></button>{serverMenu && <div className="server-menu"><button onClick={() => { setServerMenu(false); setCreateChannelOpen(true); }}><Plus /> Create channel</button></div>}</div>
      <div className="channel-list">
        {looseChannels.map(channelRow)}
        {categories.map((category) => {
          const isCollapsed = collapsed.has(category.id);
          const channels = data.channels.filter((channel) => channel.categoryId === category.id).sort((a, b) => a.position - b.position);
          return (
            <section key={category.id} className="channel-category">
              <button className="category-heading" aria-expanded={!isCollapsed} onClick={() => setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(category.id)) next.delete(category.id); else next.add(category.id);
                return next;
              })}>{isCollapsed ? <ChevronRight /> : <ChevronDown />} {category.name}</button>
              {!isCollapsed && channels.map((channel) => (
                <div key={channel.id}>
                  {channelRow(channel)}
                  {channel.kind === "voice" && channel.connectedMembers.length > 0 && (
                    <div className="voice-members">
                      {channel.connectedMembers.map((member) => <button key={member.id} onClick={() => app.setInfoOpen(true)}><Avatar user={member} size={24} /><span>{member.displayName}</span></button>)}
                    </div>
                  )}
                </div>
              ))}
            </section>
          );
        })}
      </div>
      {call.roomId && <CompactCallBar />}
      <AccountFooter />
      {createChannelOpen && <CreateChannelDialog serverId={serverId} onClose={() => setCreateChannelOpen(false)} />}
    </aside>
  );
}

function CompactCallBar() {
  const call = useCall();
  return (
    <div className="compact-call-bar">
      <button className="call-identity" onClick={() => call.setSurfaceOpen(true)}><strong>{call.status === "reconnecting" ? "Reconnecting..." : call.title}</strong><small>{call.status}</small></button>
      <IconButton label={call.muted ? "Unmute" : "Mute"} active={call.muted} onClick={() => void call.toggleMute()}><Volume2 /></IconButton>
      <IconButton label="Disconnect" className="danger-icon" onClick={() => { void call.leave(); }}><LogOut /></IconButton>
    </div>
  );
}

function AccountFooter() {
  const app = useApp();
  const me = app.me!;
  return (
    <footer className="account-footer">
      <Avatar user={me} size={36} presence={me.presence} />
      <button className="account-copy" onClick={() => app.setSettingsOpen(true)}><strong>{me.displayName}</strong><small>@{me.username}</small></button>
      <IconButton label="Settings" onClick={() => app.setSettingsOpen(true)}><Settings /></IconButton>
    </footer>
  );
}
