import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type {
  AppSettings,
  Attachment,
  BootstrapPayload,
  FriendEntry,
  Id,
  Message,
  MessageKind,
  MessagePreview,
  UserSummary,
} from "@snezhok/contracts";
import { api, RequestError, type AuthCredentials } from "../lib/api.js";
import { closeRealtimeSocket, getRealtimeSocket } from "../lib/realtime.js";

export interface StreamSelection {
  kind: "conversation" | "channel";
  id: Id;
}

type AuthStatus = "checking" | "guest" | "ready";
type View = "stream" | "friends";

interface AppContextValue {
  status: AuthStatus;
  bootstrap: BootstrapPayload | null;
  me: UserSummary | null;
  selection: StreamSelection | null;
  view: View;
  messages: Message[];
  loadingMessages: boolean;
  hasOlderMessages: boolean;
  replyingTo: Message | null;
  editing: Message | null;
  drawerOpen: boolean;
  infoOpen: boolean;
  settingsOpen: boolean;
  searchOpen: boolean;
  pinsOpen: boolean;
  online: boolean;
  socketConnected: boolean;
  toast: string | null;
  typingUserIds: Id[];
  authError: string | null;
  login: (credentials: AuthCredentials) => Promise<void>;
  register: (credentials: AuthCredentials) => Promise<void>;
  logout: () => Promise<void>;
  refreshBootstrap: () => Promise<void>;
  selectStream: (selection: StreamSelection) => void;
  showFriends: () => void;
  setDrawerOpen: (open: boolean) => void;
  setInfoOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setPinsOpen: (open: boolean) => void;
  setReplyingTo: (message: Message | null) => void;
  setEditing: (message: Message | null) => void;
  loadOlder: () => Promise<void>;
  sendMessage: (input: { text: string; kind: MessageKind; attachments: Attachment[] }) => Promise<void>;
  retryMessage: (message: Message) => Promise<void>;
  editMessage: (message: Message, text: string) => Promise<void>;
  deleteMessage: (message: Message) => Promise<void>;
  reactToMessage: (message: Message, emoji: string) => Promise<void>;
  togglePin: (message: Message) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  updateProfile: (patch: Partial<Pick<UserSummary, "displayName" | "bio" | "statusText">>) => Promise<void>;
  replaceFriend: (entry: FriendEntry) => void;
  removeFriendEntry: (userId: Id) => void;
  announce: (message: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);
const BOOTSTRAP_CACHE = "snezhok.v3.bootstrap";
const SELECTION_CACHE = "snezhok.v3.selection";

function cacheKey(selection: StreamSelection) {
  return `snezhok.v3.messages.${selection.kind}.${selection.id}`;
}

function selectionKey(selection: StreamSelection) {
  return `${selection.kind}:${selection.id}`;
}

function parseCache<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or disabled cache must not break messaging.
  }
}

function initialSelection(payload: BootstrapPayload): StreamSelection | null {
  const cached = parseCache<StreamSelection>(SELECTION_CACHE);
  if (cached?.kind === "conversation" && payload.conversations.some((item) => item.id === cached.id)) return cached;
  if (cached?.kind === "channel" && payload.channels.some((item) => item.id === cached.id)) return cached;
  const conversation = payload.conversations.find((item) => !item.archived) || payload.conversations[0];
  if (conversation) return { kind: "conversation", id: conversation.id };
  const channel = payload.channels.find((item) => item.kind === "text");
  return channel ? { kind: "channel", id: channel.id } : null;
}

function mergeMessage(list: Message[], incoming: Message): Message[] {
  const optimisticIndex = list.findIndex((message) =>
    message.id === incoming.id || (message.pending && message.id === incoming.id),
  );
  if (optimisticIndex >= 0) {
    const next = [...list];
    next[optimisticIndex] = incoming;
    return next.sort((a, b) => a.sequence - b.sequence);
  }
  if (list.some((message) => message.id === incoming.id)) return list;
  return [...list, incoming].sort((a, b) => a.sequence - b.sequence);
}

function toPreview(message: Message): MessagePreview {
  return {
    id: message.id,
    senderId: message.sender.id,
    senderName: message.sender.displayName,
    text: message.text,
    kind: message.kind,
    createdAt: message.createdAt,
  };
}

function userMessage(error: unknown): string {
  if (error instanceof RequestError) return error.message;
  if (error instanceof Error) return error.message;
  return "Request failed. Retry.";
}

export function AppProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(() => parseCache(BOOTSTRAP_CACHE));
  const [selection, setSelection] = useState<StreamSelection | null>(null);
  const [view, setView] = useState<View>("stream");
  const [messagesByStream, setMessagesByStream] = useState<Record<string, Message[]>>({});
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [socketConnected, setSocketConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [typingByStream, setTypingByStream] = useState<Record<Id, Id[]>>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const selectionRef = useRef<StreamSelection | null>(null);
  const toastTimer = useRef<number | null>(null);

  const announce = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const applyBootstrap = useCallback((payload: BootstrapPayload) => {
    setBootstrap(payload);
    writeCache(BOOTSTRAP_CACHE, payload);
    setSelection((current) => {
      if (current) return current;
      const next = initialSelection(payload);
      selectionRef.current = next;
      return next;
    });
  }, []);

  const refreshBootstrap = useCallback(async () => {
    const payload = await api.bootstrap();
    applyBootstrap(payload);
  }, [applyBootstrap]);

  useEffect(() => {
    let active = true;
    api.me()
      .then(async () => {
        const payload = await api.bootstrap();
        if (!active) return;
        applyBootstrap(payload);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof RequestError && error.status === 401) {
          setBootstrap(null);
          setStatus("guest");
        } else if (parseCache(BOOTSTRAP_CACHE)) {
          setStatus("ready");
        } else {
          setAuthError(userMessage(error));
          setStatus("guest");
        }
      });
    return () => { active = false; };
  }, [applyBootstrap]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || !bootstrap) return;
    const socket = getRealtimeSocket();
    const onCreated = (message: Message) => {
      const key = `${message.streamKind}:${message.streamId}`;
      setMessagesByStream((current) => ({ ...current, [key]: mergeMessage(current[key] || [], message) }));
    };
    const onUpdated = (message: Message) => onCreated(message);
    const onDeleted = ({ id, streamId, deletedAt }: { id: Id; streamId: Id; deletedAt: number }) => {
      setMessagesByStream((current) => {
        const entries = Object.entries(current).map(([key, list]) => [
          key,
          key.endsWith(`:${streamId}`) ? list.map((message) => message.id === id ? { ...message, deletedAt, text: "", attachments: [] } : message) : list,
        ] as const);
        return Object.fromEntries(entries);
      });
    };
    const onConversation = (conversation: BootstrapPayload["conversations"][number]) => {
      setBootstrap((current) => current ? { ...current, conversations: [...current.conversations.filter((item) => item.id !== conversation.id), conversation].sort((a, b) => b.updatedAt - a.updatedAt) } : current);
    };
    const onChannel = (channel: BootstrapPayload["channels"][number]) => {
      setBootstrap((current) => current ? { ...current, channels: current.channels.map((item) => item.id === channel.id ? channel : item) } : current);
    };
    const onFriend = (entry: FriendEntry) => {
      setBootstrap((current) => current ? { ...current, friends: [...current.friends.filter((item) => item.user.id !== entry.user.id), entry] } : current);
    };
    const onPresence = ({ userId, presence, lastSeenAt }: { userId: Id; presence: UserSummary["presence"]; lastSeenAt: number }) => {
      setBootstrap((current) => {
        if (!current) return current;
        const updateUser = (user: UserSummary) => user.id === userId ? { ...user, presence, lastSeenAt } : user;
        return {
          ...current,
          friends: current.friends.map((entry) => ({ ...entry, user: updateUser(entry.user) })),
          conversations: current.conversations.map((conversation) => ({ ...conversation, participants: conversation.participants.map(updateUser) })),
          channels: current.channels.map((channel) => ({ ...channel, connectedMembers: channel.connectedMembers.map(updateUser) })),
        };
      });
    };
    const onTyping = ({ streamId, userId, typing }: { streamId: Id; userId: Id; typing: boolean }) => {
      if (userId === bootstrap.me.id) return;
      setTypingByStream((current) => {
        const users = new Set(current[streamId] || []);
        if (typing) users.add(userId); else users.delete(userId);
        return { ...current, [streamId]: [...users] };
      });
    };
    const onConnect = () => {
      setSocketConnected(true);
      socket.emit("sync:resume", { cursor: bootstrap.eventCursor }, (accepted) => {
        if (!accepted) void refreshBootstrap();
      });
      const active = selectionRef.current;
      if (active) socket.emit("stream:join", { streamId: active.id }, () => undefined);
    };
    const onDisconnect = () => setSocketConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("message:created", onCreated);
    socket.on("message:updated", onUpdated);
    socket.on("message:deleted", onDeleted);
    socket.on("conversation:updated", onConversation);
    socket.on("channel:updated", onChannel);
    socket.on("friend:updated", onFriend);
    socket.on("presence:updated", onPresence);
    socket.on("typing:updated", onTyping);
    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("message:created", onCreated);
      socket.off("message:updated", onUpdated);
      socket.off("message:deleted", onDeleted);
      socket.off("conversation:updated", onConversation);
      socket.off("channel:updated", onChannel);
      socket.off("friend:updated", onFriend);
      socket.off("presence:updated", onPresence);
      socket.off("typing:updated", onTyping);
      closeRealtimeSocket();
      setSocketConnected(false);
    };
  }, [bootstrap?.me.id, refreshBootstrap, status]);

  const authenticate = useCallback(async (mode: "login" | "register", credentials: AuthCredentials) => {
    setAuthError(null);
    try {
      if (mode === "login") await api.login(credentials);
      else await api.register(credentials);
      const payload = await api.bootstrap();
      applyBootstrap(payload);
      setStatus("ready");
    } catch (error) {
      const message = userMessage(error);
      setAuthError(message);
      throw error;
    }
  }, [applyBootstrap]);

  const logout = useCallback(async () => {
    try { await api.logout(); } finally {
      closeRealtimeSocket();
      setBootstrap(null);
      setSelection(null);
      setMessagesByStream({});
      localStorage.removeItem(BOOTSTRAP_CACHE);
      setStatus("guest");
    }
  }, []);

  const loadMessages = useCallback(async (target: StreamSelection, cursor?: string) => {
    const key = selectionKey(target);
    setLoadingMessages(true);
    try {
      const page = await api.messages(target.kind, target.id, cursor);
      setMessagesByStream((current) => {
        const existing = current[key] || [];
        const combined = cursor ? [...page.items, ...existing] : [...page.items, ...existing.filter((item) => item.pending || item.failed)];
        const unique = Array.from(new Map(combined.map((item) => [item.id, item])).values()).sort((a, b) => a.sequence - b.sequence);
        writeCache(cacheKey(target), unique.slice(-100));
        return { ...current, [key]: unique };
      });
      setCursors((current) => ({ ...current, [key]: page.nextCursor }));
      const latest = page.items.at(-1);
      if (latest) {
        await api.markRead(target.kind, target.id, latest.sequence).catch(() => undefined);
        getRealtimeSocket().emit("read:set", { streamId: target.id, sequence: latest.sequence });
      }
    } catch (error) {
      if (!(messagesByStream[key]?.length)) announce(userMessage(error));
    } finally {
      setLoadingMessages(false);
    }
  }, [announce, messagesByStream]);

  const selectStream = useCallback((next: StreamSelection) => {
    const previous = selectionRef.current;
    if (previous?.id === next.id && previous.kind === next.kind) {
      setView("stream");
      setDrawerOpen(false);
      return;
    }
    const socket = getRealtimeSocket();
    if (previous) socket.emit("stream:leave", { streamId: previous.id });
    selectionRef.current = next;
    setSelection(next);
    writeCache(SELECTION_CACHE, next);
    setView("stream");
    setReplyingTo(null);
    setEditing(null);
    setDrawerOpen(false);
    setInfoOpen(false);
    const cached = parseCache<Message[]>(cacheKey(next));
    if (cached) setMessagesByStream((current) => ({ ...current, [selectionKey(next)]: cached }));
    socket.emit("stream:join", { streamId: next.id }, () => undefined);
    void loadMessages(next);
  }, [loadMessages]);

  useEffect(() => {
    if (!selection || status !== "ready") return;
    selectionRef.current = selection;
    const key = selectionKey(selection);
    const cached = parseCache<Message[]>(cacheKey(selection));
    if (cached && !(messagesByStream[key]?.length)) setMessagesByStream((current) => ({ ...current, [key]: cached }));
    void loadMessages(selection);
    // The active stream changes explicitly through selectStream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, selection?.id, selection?.kind]);

  const loadOlder = useCallback(async () => {
    if (!selection) return;
    const cursor = cursors[selectionKey(selection)];
    if (cursor) await loadMessages(selection, cursor);
  }, [cursors, loadMessages, selection]);

  const sendMessage = useCallback(async ({ text, kind, attachments }: { text: string; kind: MessageKind; attachments: Attachment[] }) => {
    if (!selection || !bootstrap?.me) return;
    const clientId = crypto.randomUUID();
    const key = selectionKey(selection);
    const optimistic: Message = {
      id: clientId,
      streamId: selection.id,
      streamKind: selection.kind,
      sequence: Date.now(),
      sender: bootstrap.me,
      kind,
      text,
      replyTo: replyingTo ? toPreview(replyingTo) : null,
      attachments,
      reactions: [],
      createdAt: Date.now(),
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      pending: true,
    };
    setMessagesByStream((current) => ({ ...current, [key]: mergeMessage(current[key] || [], optimistic) }));
    setReplyingTo(null);
    try {
      const result = await api.sendMessage(selection.kind, selection.id, {
        clientId,
        text,
        kind,
        replyToId: replyingTo?.id || null,
        attachmentIds: attachments.map((attachment) => attachment.id),
      });
      setMessagesByStream((current) => ({
        ...current,
        [key]: Array.from(new Map((current[key] || []).map((message) => message.id === clientId ? result.message : message).map((message) => [message.id, message])).values()).sort((a, b) => a.sequence - b.sequence),
      }));
    } catch (error) {
      setMessagesByStream((current) => ({
        ...current,
        [key]: (current[key] || []).map((message) => message.id === clientId ? { ...message, pending: false, failed: true } : message),
      }));
      announce(userMessage(error));
    }
  }, [announce, bootstrap?.me, replyingTo, selection]);

  const editMessage = useCallback(async (message: Message, text: string) => {
    try {
      const result = await api.editMessage(message.id, text);
      const key = `${message.streamKind}:${message.streamId}`;
      setMessagesByStream((current) => ({ ...current, [key]: mergeMessage(current[key] || [], result.message) }));
      setEditing(null);
    } catch (error) { announce(userMessage(error)); }
  }, [announce]);

  const retryMessage = useCallback(async (message: Message) => {
    const key = `${message.streamKind}:${message.streamId}`;
    setMessagesByStream((current) => ({ ...current, [key]: (current[key] || []).map((item) => item.id === message.id ? { ...item, failed: false, pending: true } : item) }));
    try {
      const result = await api.sendMessage(message.streamKind, message.streamId, {
        clientId: message.id,
        text: message.text,
        kind: message.kind,
        replyToId: message.replyTo?.id || null,
        attachmentIds: message.attachments.map((attachment) => attachment.id),
      });
      setMessagesByStream((current) => ({ ...current, [key]: Array.from(new Map((current[key] || []).map((item) => item.id === message.id ? result.message : item).map((item) => [item.id, item])).values()).sort((a, b) => a.sequence - b.sequence) }));
    } catch (error) {
      setMessagesByStream((current) => ({ ...current, [key]: (current[key] || []).map((item) => item.id === message.id ? { ...item, pending: false, failed: true } : item) }));
      announce(userMessage(error));
    }
  }, [announce]);

  const deleteMessage = useCallback(async (message: Message) => {
    try {
      await api.deleteMessage(message.id);
      const key = `${message.streamKind}:${message.streamId}`;
      setMessagesByStream((current) => ({ ...current, [key]: (current[key] || []).map((item) => item.id === message.id ? { ...item, deletedAt: Date.now(), text: "", attachments: [] } : item) }));
    } catch (error) { announce(userMessage(error)); }
  }, [announce]);

  const reactToMessage = useCallback(async (message: Message, emoji: string) => {
    const reacted = message.reactions.some((reaction) => reaction.emoji === emoji && reaction.reacted);
    try {
      const result = await api.react(message.id, emoji, reacted);
      const key = `${message.streamKind}:${message.streamId}`;
      setMessagesByStream((current) => ({ ...current, [key]: mergeMessage(current[key] || [], result.message) }));
    } catch (error) { announce(userMessage(error)); }
  }, [announce]);

  const togglePin = useCallback(async (message: Message) => {
    try {
      const result = await api.pin(message.id, Boolean(message.pinnedAt));
      const key = `${message.streamKind}:${message.streamId}`;
      setMessagesByStream((current) => ({ ...current, [key]: mergeMessage(current[key] || [], result.message) }));
      announce(message.pinnedAt ? "Message unpinned." : "Message pinned.");
    } catch (error) { announce(userMessage(error)); }
  }, [announce]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    if (!bootstrap) return;
    const previous = bootstrap.settings;
    setBootstrap({ ...bootstrap, settings: { ...previous, ...patch } });
    try {
      const result = await api.settings.update(patch);
      setBootstrap((current) => current ? { ...current, settings: result.settings } : current);
    } catch (error) {
      setBootstrap((current) => current ? { ...current, settings: previous } : current);
      announce(userMessage(error));
    }
  }, [announce, bootstrap]);

  const updateProfile = useCallback(async (patch: Partial<Pick<UserSummary, "displayName" | "bio" | "statusText">>) => {
    try {
      const result = await api.profile(patch);
      setBootstrap((current) => current ? { ...current, me: result.me } : current);
      announce("Profile saved.");
    } catch (error) { announce(userMessage(error)); }
  }, [announce]);

  const replaceFriend = useCallback((entry: FriendEntry) => {
    setBootstrap((current) => current ? { ...current, friends: [...current.friends.filter((item) => item.user.id !== entry.user.id), entry] } : current);
  }, []);

  const removeFriendEntry = useCallback((userId: Id) => {
    setBootstrap((current) => current ? { ...current, friends: current.friends.filter((item) => item.user.id !== userId) } : current);
  }, []);

  const messages = selection ? messagesByStream[selectionKey(selection)] || [] : [];
  const hasOlderMessages = selection ? Boolean(cursors[selectionKey(selection)]) : false;

  const value = useMemo<AppContextValue>(() => ({
    status,
    bootstrap,
    me: bootstrap?.me || null,
    selection,
    view,
    messages,
    loadingMessages,
    hasOlderMessages,
    replyingTo,
    editing,
    drawerOpen,
    infoOpen,
    settingsOpen,
    searchOpen,
    pinsOpen,
    online,
    socketConnected,
    toast,
    typingUserIds: selection ? typingByStream[selection.id] || [] : [],
    authError,
    login: (credentials) => authenticate("login", credentials),
    register: (credentials) => authenticate("register", credentials),
    logout,
    refreshBootstrap,
    selectStream,
    showFriends: () => { setView("friends"); setDrawerOpen(false); },
    setDrawerOpen,
    setInfoOpen,
    setSettingsOpen,
    setSearchOpen,
    setPinsOpen,
    setReplyingTo,
    setEditing,
    loadOlder,
    sendMessage,
    retryMessage,
    editMessage,
    deleteMessage,
    reactToMessage,
    togglePin,
    updateSettings,
    updateProfile,
    replaceFriend,
    removeFriendEntry,
    announce,
  }), [
    announce, authError, authenticate, bootstrap, deleteMessage, drawerOpen, editMessage, editing,
    hasOlderMessages, infoOpen, loadOlder, loadingMessages, logout, messages, online, pinsOpen,
    reactToMessage, refreshBootstrap, replyingTo, retryMessage, searchOpen, selectStream, selection, sendMessage,
    settingsOpen, socketConnected, status, toast, togglePin, typingByStream, updateProfile, updateSettings, view,
    replaceFriend, removeFriendEntry,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}
