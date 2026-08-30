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
  CallUpdatePayload,
  FriendEntry,
  Id,
  Message,
  MessageKind,
  UserSummary,
} from "@snezhok/contracts";
import { api, RequestError, type AuthCredentials } from "../lib/api.js";
import {
  cacheMessages,
  claimOfflineOwner,
  clearOfflineData,
  enqueueOutbox,
  loadCachedMessages,
  loadOutbox,
  removeOutbox,
  updateOutbox,
  type OutboxEntry,
} from "../lib/offlineStore.js";
import { closeRealtimeSocket, getRealtimeSocket } from "../lib/realtime.js";
import { cacheBootstrap, cacheSelection, cachedBootstrap, cachedOwnerId, clearCachedSession, initialSelection, isPermanentOutboxFailure, mergeMessage, outboxDelay, selectionKey, setCachedOwner, toPreview, userMessage, type StreamSelection } from "./appContextDomain.js";
export type { StreamSelection } from "./appContextDomain.js";

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
  clearOfflineCache: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(cachedBootstrap);
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
  const flushingOutbox = useRef(new Set<Id>());
  const settingsGeneration = useRef(0);
  const settingsQueue = useRef<Promise<void>>(Promise.resolve());
  const offlineClear = useRef<Promise<void>>(Promise.resolve());
  const sessionGeneration = useRef(0);
  const ownerRef = useRef<Id | null>(bootstrap?.me.id ?? null);
  const eventCursorRef = useRef(bootstrap?.eventCursor ?? 0);
  const streamKindById = useRef(new Map<Id, StreamSelection["kind"]>());
  streamKindById.current = new Map([
    ...(bootstrap?.conversations.map((item) => [item.id, "conversation"] as const) ?? []),
    ...(bootstrap?.channels.map((item) => [item.id, "channel"] as const) ?? []),
  ]);

  const sessionIsActive = useCallback((generation: number, ownerId: Id | null) => (
    generation === sessionGeneration.current && ownerId !== null && ownerRef.current === ownerId
  ), []);

  const invalidateSession = useCallback(() => {
    sessionGeneration.current += 1;
    ownerRef.current = null;
    settingsGeneration.current += 1;
    flushingOutbox.current.clear();
  }, []);

  const announce = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const applyBootstrap = useCallback((payload: BootstrapPayload) => {
    ownerRef.current = payload.me.id;
    eventCursorRef.current = Math.max(eventCursorRef.current, payload.eventCursor);
    const currentPayload = payload.eventCursor === eventCursorRef.current
      ? payload
      : { ...payload, eventCursor: eventCursorRef.current };
    setBootstrap(currentPayload);
    cacheBootstrap(currentPayload);
    setSelection((current) => {
      if (current) return current;
      const next = initialSelection(currentPayload);
      selectionRef.current = next;
      return next;
    });
  }, []);

  const prepareOfflineOwner = useCallback(async (payload: BootstrapPayload) => {
    const previous = cachedOwnerId();
    const changed = await claimOfflineOwner(payload.me.id);
    if (changed || (previous && previous !== payload.me.id)) {
      clearCachedSession({ preserveOwner: true });
      setMessagesByStream({});
      setCursors({});
      setSelection(null);
      selectionRef.current = null;
    }
    setCachedOwner(payload.me.id);
    ownerRef.current = payload.me.id;
  }, []);

  const refreshBootstrap = useCallback(async () => {
    const generation = sessionGeneration.current;
    const ownerId = ownerRef.current;
    const payload = await api.bootstrap();
    if (!sessionIsActive(generation, ownerId) || payload.me.id !== ownerId) return;
    await prepareOfflineOwner(payload);
    if (!sessionIsActive(generation, ownerId)) return;
    applyBootstrap(payload);
  }, [applyBootstrap, prepareOfflineOwner, sessionIsActive]);

  useEffect(() => {
    let active = true;
    const generation = sessionGeneration.current;
    api.me()
      .then(async () => {
        const payload = await api.bootstrap();
        if (!active || generation !== sessionGeneration.current) return;
        await prepareOfflineOwner(payload);
        if (!active || generation !== sessionGeneration.current) return;
        applyBootstrap(payload);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof RequestError && error.status === 401) {
          setBootstrap(null);
          setStatus("guest");
        } else if (cachedBootstrap()) {
          setStatus("ready");
        } else {
          setAuthError(userMessage(error));
          setStatus("guest");
        }
      });
    return () => { active = false; };
  }, [applyBootstrap, prepareOfflineOwner]);

  useEffect(() => {
    const expire = () => {
      invalidateSession();
      closeRealtimeSocket();
      setBootstrap(null);
      setSelection(null);
      selectionRef.current = null;
      setMessagesByStream({});
      setCursors({});
      clearCachedSession();
      offlineClear.current = clearOfflineData();
      void offlineClear.current.catch(() => undefined);
      setStatus("guest");
    };
    window.addEventListener("snezhok:auth-expired", expire);
    return () => window.removeEventListener("snezhok:auth-expired", expire);
  }, [invalidateSession]);

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
      setMessagesByStream((current) => {
        const loaded = current[key];
        const next = mergeMessage(loaded || [], message);
        if (loaded) void cacheMessages(key, next);
        else void loadCachedMessages(key).then((cached) => cacheMessages(key, mergeMessage(cached, message)));
        return { ...current, [key]: next };
      });
      if (message.clientId) void removeOutbox(message.clientId).catch(() => undefined);
    };
    const onUpdated = (message: Message) => onCreated(message);
    const onDeleted = ({ id, streamId, deletedAt }: { id: Id; streamId: Id; deletedAt: number }) => {
      const kind = streamKindById.current.get(streamId);
      if (!kind) return;
      const key = `${kind}:${streamId}`;
      setMessagesByStream((current) => {
        const loaded = current[key];
        if (!loaded) {
          void loadCachedMessages(key).then((cached) => {
            const next = cached.map((message) => message.id === id ? { ...message, deletedAt, text: "", attachments: [] } : message);
            if (next.some((message, index) => message !== cached[index])) void cacheMessages(key, next);
          });
          return current;
        }
        const next = loaded.map((message) => message.id === id ? { ...message, deletedAt, text: "", attachments: [] } : message);
        if (!next.some((message, index) => message !== loaded[index])) return current;
        void cacheMessages(key, next);
        return { ...current, [key]: next };
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
    const onSyncReady = ({ cursor }: { cursor: number }) => {
      if (cursor <= eventCursorRef.current) return;
      eventCursorRef.current = cursor;
      setBootstrap((current) => {
        if (!current || cursor <= current.eventCursor) return current;
        const next = { ...current, eventCursor: cursor };
        cacheBootstrap(next);
        return next;
      });
    };
    const onCallUpdated = (payload: CallUpdatePayload) => {
      window.dispatchEvent(new CustomEvent("snezhok:call-updated", { detail: payload }));
    };
    const onConnect = () => {
      setSocketConnected(true);
      socket.emit("sync:resume", { cursor: eventCursorRef.current }, (accepted) => {
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
    socket.on("sync:ready", onSyncReady);
    socket.on("call:updated", onCallUpdated);
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
      socket.off("sync:ready", onSyncReady);
      socket.off("call:updated", onCallUpdated);
      closeRealtimeSocket();
      setSocketConnected(false);
    };
  }, [bootstrap?.me.id, refreshBootstrap, status]);

  const authenticate = useCallback(async (mode: "login" | "register", credentials: AuthCredentials) => {
    invalidateSession();
    const generation = sessionGeneration.current;
    setAuthError(null);
    try {
      await offlineClear.current.catch(() => undefined);
      if (mode === "login") await api.login(credentials);
      else await api.register(credentials);
      const payload = await api.bootstrap();
      if (generation !== sessionGeneration.current) return;
      await prepareOfflineOwner(payload);
      if (generation !== sessionGeneration.current) return;
      applyBootstrap(payload);
      setStatus("ready");
    } catch (error) {
      const message = userMessage(error);
      setAuthError(message);
      throw error;
    }
  }, [applyBootstrap, invalidateSession, prepareOfflineOwner]);

  const logout = useCallback(async () => {
    invalidateSession();
    const lifecycle: Promise<unknown>[] = [];
    window.dispatchEvent(new CustomEvent("snezhok:before-logout", {
      detail: { waitUntil: (promise: Promise<unknown>) => lifecycle.push(promise) },
    }));
    await Promise.allSettled(lifecycle);
    try { await api.logout(); } finally {
      closeRealtimeSocket();
      setBootstrap(null);
      setSelection(null);
      selectionRef.current = null;
      setMessagesByStream({});
      setCursors({});
      clearCachedSession();
      offlineClear.current = clearOfflineData();
      await offlineClear.current.catch(() => undefined);
      setStatus("guest");
    }
  }, [invalidateSession]);

  const loadMessages = useCallback(async (target: StreamSelection, cursor?: string) => {
    const generation = sessionGeneration.current;
    const ownerId = ownerRef.current;
    const key = selectionKey(target);
    setLoadingMessages(true);
    try {
      const page = await api.messages(target.kind, target.id, cursor);
      if (!sessionIsActive(generation, ownerId)) return;
      setMessagesByStream((current) => {
        const existing = current[key] || [];
        // Server pages are reduced last so an acknowledged message replaces
        // its optimistic row by clientId instead of the stale row winning.
        const combined = cursor ? [...existing, ...page.items] : [...existing.filter((item) => item.pending || item.failed), ...page.items];
        const unique = combined.reduce<Message[]>((list, item) => mergeMessage(list, item), []);
        void cacheMessages(key, unique);
        return { ...current, [key]: unique };
      });
      setCursors((current) => ({ ...current, [key]: page.nextCursor }));
      const latest = page.items.at(-1);
      if (latest) {
        await api.markRead(target.kind, target.id, latest.sequence).catch(() => undefined);
        if (sessionIsActive(generation, ownerId)) getRealtimeSocket().emit("read:set", { streamId: target.id, sequence: latest.sequence });
      }
    } catch (error) {
      if (sessionIsActive(generation, ownerId) && !(messagesByStream[key]?.length)) announce(userMessage(error));
    } finally {
      if (sessionIsActive(generation, ownerId)) setLoadingMessages(false);
    }
  }, [announce, messagesByStream, sessionIsActive]);

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
    cacheSelection(next);
    setView("stream");
    setReplyingTo(null);
    setEditing(null);
    setDrawerOpen(false);
    setInfoOpen(false);
    socket.emit("stream:join", { streamId: next.id }, () => undefined);
  }, []);

  useEffect(() => {
    if (!selection || status !== "ready") return;
    selectionRef.current = selection;
    const key = selectionKey(selection);
    let active = true;
    void loadCachedMessages(key).then((cached) => {
      if (active && cached.length) setMessagesByStream((current) => ({
        ...current,
        [key]: (current[key] || []).reduce((list, message) => mergeMessage(list, message), cached),
      }));
    }).finally(() => { if (active) void loadMessages(selection); });
    return () => { active = false; };
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
    const generation = sessionGeneration.current;
    const ownerId = bootstrap.me.id;
    const clientId = crypto.randomUUID();
    const key = selectionKey(selection);
    const optimistic: Message = {
      id: clientId,
      clientId,
      streamId: selection.id,
      streamKind: selection.kind,
      sequence: Date.now(),
      sender: bootstrap.me,
      kind,
      text,
      replyTo: replyingTo ? toPreview(replyingTo) : null,
      forwardedFrom: null,
      attachments,
      reactions: [],
      createdAt: Date.now(),
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      pending: true,
    };
    const outbox: OutboxEntry = {
      clientId, streamId: selection.id, streamKind: selection.kind, text, kind,
      replyToId: replyingTo?.id || null,
      attachmentIds: attachments.map((attachment) => attachment.id),
      optimistic, createdAt: Date.now(),
    };
    try {
      await enqueueOutbox(outbox);
    } catch (error) {
      if (sessionIsActive(generation, ownerId)) announce(`Message was not queued: ${userMessage(error)}`);
      throw error;
    }
    if (!sessionIsActive(generation, ownerId)) {
      await removeOutbox(clientId).catch(() => undefined);
      return;
    }
    setMessagesByStream((current) => {
      const next = mergeMessage(current[key] || [], optimistic);
      void cacheMessages(key, next);
      return { ...current, [key]: next };
    });
    setReplyingTo(null);
    let result: { message: Message };
    try {
      result = await api.sendMessage(selection.kind, selection.id, {
        clientId,
        text,
        kind,
        replyToId: replyingTo?.id || null,
        attachmentIds: attachments.map((attachment) => attachment.id),
      });
    } catch (error) {
      if (!sessionIsActive(generation, ownerId)) {
        await removeOutbox(clientId).catch(() => undefined);
        return;
      }
      setMessagesByStream((current) => {
        const next = (current[key] || []).map((message) => message.id === clientId ? { ...message, pending: false, failed: true } : message);
        void cacheMessages(key, next);
        return { ...current, [key]: next };
      });
      if (navigator.onLine) announce(userMessage(error));
      return;
    }
    if (!sessionIsActive(generation, ownerId)) {
      await removeOutbox(clientId).catch(() => undefined);
      return;
    }
    setMessagesByStream((current) => {
      const next = mergeMessage(current[key] || [], result.message);
      void cacheMessages(key, next);
      return { ...current, [key]: next };
    });
    await removeOutbox(clientId).catch((error) => announce(`Message sent, but offline queue cleanup failed: ${userMessage(error)}`));
  }, [announce, bootstrap?.me, replyingTo, selection, sessionIsActive]);

  const editMessage = useCallback(async (message: Message, text: string) => {
    const generation = sessionGeneration.current;
    const ownerId = ownerRef.current;
    try {
      const result = await api.editMessage(message.id, text);
      if (!sessionIsActive(generation, ownerId)) return;
      const key = `${message.streamKind}:${message.streamId}`;
      setMessagesByStream((current) => ({ ...current, [key]: mergeMessage(current[key] || [], result.message) }));
      setEditing(null);
    } catch (error) { if (sessionIsActive(generation, ownerId)) announce(userMessage(error)); }
  }, [announce, sessionIsActive]);

  const retryMessage = useCallback(async (message: Message) => {
    const generation = sessionGeneration.current;
    const ownerId = ownerRef.current;
    if (!ownerId) return;
    const key = `${message.streamKind}:${message.streamId}`;
    const clientId = message.clientId ?? message.id;
    try { await enqueueOutbox({
      clientId, streamId: message.streamId, streamKind: message.streamKind, text: message.text, kind: message.kind,
      replyToId: message.replyTo?.id || null, attachmentIds: message.attachments.map((attachment) => attachment.id),
      optimistic: { ...message, clientId, pending: true, failed: false }, createdAt: message.createdAt,
    }); } catch (error) {
      if (sessionIsActive(generation, ownerId)) announce(`Message was not queued: ${userMessage(error)}`);
      return;
    }
    if (!sessionIsActive(generation, ownerId)) {
      await removeOutbox(clientId).catch(() => undefined);
      return;
    }
    setMessagesByStream((current) => ({ ...current, [key]: (current[key] || []).map((item) => item.id === message.id ? { ...item, failed: false, pending: true } : item) }));
    try {
      const result = await api.sendMessage(message.streamKind, message.streamId, {
        clientId,
        text: message.text,
        kind: message.kind,
        replyToId: message.replyTo?.id || null,
        attachmentIds: message.attachments.map((attachment) => attachment.id),
      });
      if (!sessionIsActive(generation, ownerId)) {
        await removeOutbox(clientId).catch(() => undefined);
        return;
      }
      setMessagesByStream((current) => ({ ...current, [key]: mergeMessage(current[key] || [], result.message) }));
      await removeOutbox(clientId).catch((error) => announce(`Message sent, but offline queue cleanup failed: ${userMessage(error)}`));
    } catch (error) {
      if (!sessionIsActive(generation, ownerId)) {
        await removeOutbox(clientId).catch(() => undefined);
        return;
      }
      setMessagesByStream((current) => ({ ...current, [key]: (current[key] || []).map((item) => item.id === message.id ? { ...item, pending: false, failed: true } : item) }));
      announce(userMessage(error));
    }
  }, [announce, sessionIsActive]);

  const flushOutbox = useCallback(async () => {
    if (!navigator.onLine) return;
    const generation = sessionGeneration.current;
    const ownerId = ownerRef.current;
    if (!ownerId) return;
    let entries: OutboxEntry[];
    try { entries = await loadOutbox(); }
    catch (error) {
      if (sessionIsActive(generation, ownerId)) announce(`Offline queue unavailable: ${userMessage(error)}`);
      return;
    }
    if (!sessionIsActive(generation, ownerId)) return;
    for (const entry of entries) {
      if (!sessionIsActive(generation, ownerId)) return;
      if ((entry.nextAttemptAt ?? 0) > Date.now()) continue;
      if (flushingOutbox.current.has(entry.clientId)) continue;
      flushingOutbox.current.add(entry.clientId);
      const key = `${entry.streamKind}:${entry.streamId}`;
      setMessagesByStream((current) => {
        const next = mergeMessage(current[key] || [], { ...entry.optimistic, pending: true, failed: false });
        return { ...current, [key]: next };
      });
      try {
        const result = await api.sendMessage(entry.streamKind, entry.streamId, {
          clientId: entry.clientId, text: entry.text, kind: entry.kind,
          replyToId: entry.replyToId, attachmentIds: entry.attachmentIds,
        });
        if (!sessionIsActive(generation, ownerId)) return;
        setMessagesByStream((current) => {
          const next = mergeMessage(current[key] || [], result.message);
          void cacheMessages(key, next);
          return { ...current, [key]: next };
        });
        await removeOutbox(entry.clientId).catch((error) => announce(`Message sent, but offline queue cleanup failed: ${userMessage(error)}`));
      } catch (error) {
        if (!sessionIsActive(generation, ownerId)) return;
        setMessagesByStream((current) => ({ ...current, [key]: (current[key] || []).map((item) => item.clientId === entry.clientId ? { ...item, pending: false, failed: true } : item) }));
        if (isPermanentOutboxFailure(error)) {
          await removeOutbox(entry.clientId).catch((storageError) => announce(`Offline queue cleanup failed: ${userMessage(storageError)}`));
        } else {
          const attempts = (entry.attempts ?? 0) + 1;
          await updateOutbox({ ...entry, attempts, nextAttemptAt: Date.now() + outboxDelay(attempts) })
            .catch((storageError) => announce(`Offline queue update failed: ${userMessage(storageError)}`));
        }
      } finally {
        flushingOutbox.current.delete(entry.clientId);
      }
    }
  }, [announce, sessionIsActive]);

  useEffect(() => {
    if (status !== "ready") return;
    let active = true;
    const generation = sessionGeneration.current;
    const ownerId = ownerRef.current;
    void loadOutbox().then((entries) => {
      if (!active || !sessionIsActive(generation, ownerId)) return;
      setMessagesByStream((current) => {
        const next = { ...current };
        for (const entry of entries) {
          const key = `${entry.streamKind}:${entry.streamId}`;
          next[key] = mergeMessage(next[key] || [], { ...entry.optimistic, pending: navigator.onLine, failed: !navigator.onLine });
        }
        return next;
      });
    }).catch((error) => { if (active && sessionIsActive(generation, ownerId)) announce(`Offline queue unavailable: ${userMessage(error)}`); });
    return () => { active = false; };
  }, [announce, sessionIsActive, status]);

  useEffect(() => {
    if (status === "ready" && online) void flushOutbox();
  }, [flushOutbox, online, socketConnected, status]);

  useEffect(() => {
    if (status !== "ready" || !online) return;
    const timer = window.setInterval(() => { void flushOutbox(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [flushOutbox, online, status]);

  const deleteMessage = useCallback(async (message: Message) => {
    const generation = sessionGeneration.current;
    const ownerId = ownerRef.current;
    try {
      await api.deleteMessage(message.id);
      if (!sessionIsActive(generation, ownerId)) return;
      const key = `${message.streamKind}:${message.streamId}`;
      setMessagesByStream((current) => {
        const next = (current[key] || []).map((item) => item.id === message.id ? { ...item, deletedAt: Date.now(), text: "", attachments: [] } : item);
        void cacheMessages(key, next);
        return { ...current, [key]: next };
      });
    } catch (error) { if (sessionIsActive(generation, ownerId)) announce(userMessage(error)); }
  }, [announce, sessionIsActive]);

  const reactToMessage = useCallback(async (message: Message, emoji: string) => {
    const generation = sessionGeneration.current;
    const ownerId = ownerRef.current;
    const reacted = message.reactions.some((reaction) => reaction.emoji === emoji && reaction.reacted);
    try {
      const result = await api.react(message.id, emoji, reacted);
      if (!sessionIsActive(generation, ownerId)) return;
      const key = `${message.streamKind}:${message.streamId}`;
      setMessagesByStream((current) => ({ ...current, [key]: mergeMessage(current[key] || [], result.message) }));
    } catch (error) { if (sessionIsActive(generation, ownerId)) announce(userMessage(error)); }
  }, [announce, sessionIsActive]);

  const togglePin = useCallback(async (message: Message) => {
    const generation = sessionGeneration.current;
    const ownerId = ownerRef.current;
    try {
      const result = await api.pin(message.id, Boolean(message.pinnedAt));
      if (!sessionIsActive(generation, ownerId)) return;
      const key = `${message.streamKind}:${message.streamId}`;
      setMessagesByStream((current) => ({ ...current, [key]: mergeMessage(current[key] || [], result.message) }));
      announce(message.pinnedAt ? "Message unpinned." : "Message pinned.");
    } catch (error) { if (sessionIsActive(generation, ownerId)) announce(userMessage(error)); }
  }, [announce, sessionIsActive]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const session = sessionGeneration.current;
    const ownerId = ownerRef.current;
    const generation = ++settingsGeneration.current;
    setBootstrap((current) => current ? { ...current, settings: { ...current.settings, ...patch } } : current);
    settingsQueue.current = settingsQueue.current.catch(() => undefined).then(async () => {
      try {
        const result = await api.settings.update(patch);
        if (sessionIsActive(session, ownerId) && generation === settingsGeneration.current) setBootstrap((current) => current ? { ...current, settings: result.settings } : current);
      } catch (error) {
        if (!sessionIsActive(session, ownerId)) return;
        announce(userMessage(error));
        if (generation === settingsGeneration.current) await refreshBootstrap().catch(() => undefined);
      }
    });
    await settingsQueue.current;
  }, [announce, refreshBootstrap, sessionIsActive]);

  const updateProfile = useCallback(async (patch: Partial<Pick<UserSummary, "displayName" | "bio" | "statusText">>) => {
    const generation = sessionGeneration.current;
    const ownerId = ownerRef.current;
    try {
      const result = await api.profile(patch);
      if (!sessionIsActive(generation, ownerId)) return;
      setBootstrap((current) => current ? { ...current, me: { ...current.me, ...result.me } } : current);
      announce("Profile saved.");
    } catch (error) { if (sessionIsActive(generation, ownerId)) announce(userMessage(error)); }
  }, [announce, sessionIsActive]);

  const clearOfflineCache = useCallback(async () => {
    try {
      await clearOfflineData();
      flushingOutbox.current.clear();
      setMessagesByStream({});
      setCursors({});
      announce("Offline data cleared.");
    } catch (error) {
      announce(`Offline data could not be cleared: ${userMessage(error)}`);
    }
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
    clearOfflineCache,
  }), [
    announce, authError, authenticate, bootstrap, deleteMessage, drawerOpen, editMessage, editing,
    hasOlderMessages, infoOpen, loadOlder, loadingMessages, logout, messages, online, pinsOpen,
    reactToMessage, refreshBootstrap, replyingTo, retryMessage, searchOpen, selectStream, selection, sendMessage,
    settingsOpen, socketConnected, status, toast, togglePin, typingByStream, updateProfile, updateSettings, view,
    replaceFriend, removeFriendEntry, clearOfflineCache,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}
