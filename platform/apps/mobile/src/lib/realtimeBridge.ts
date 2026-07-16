interface StreamJoinPayload { streamId: string }
interface TypingPayload extends StreamJoinPayload { typing: boolean }

export interface RealtimeCommandSocket {
  connected: boolean;
  emit(event: "stream:join", payload: StreamJoinPayload, acknowledge: (accepted: boolean) => void): unknown;
  emit(event: "stream:leave", payload: StreamJoinPayload): unknown;
  emit(event: "typing:set", payload: TypingPayload): unknown;
}

type TypingListener = (userIds: readonly string[]) => void;

const requestedStreams = new Set<string>();
const typingUsers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();
const typingListeners = new Map<string, Set<TypingListener>>();
let commandSocket: RealtimeCommandSocket | null = null;

export function bindRealtimeSocket(socket: RealtimeCommandSocket | null): void {
  commandSocket = socket;
  if (!socket) clearAllTyping();
}

export function rejoinRequestedStreams(): void {
  if (!commandSocket?.connected) return;
  for (const streamId of requestedStreams) emitJoin(streamId);
}

export function joinRealtimeStream(streamId: string): void {
  requestedStreams.add(streamId);
  if (commandSocket?.connected) emitJoin(streamId);
}

export function leaveRealtimeStream(streamId: string): void {
  requestedStreams.delete(streamId);
  clearStreamTyping(streamId);
  if (commandSocket?.connected) commandSocket.emit("stream:leave", { streamId });
}

export function emitRealtimeTyping(streamId: string, typing: boolean): void {
  if (!requestedStreams.has(streamId) || !commandSocket?.connected) return;
  commandSocket.emit("typing:set", { streamId, typing });
}

export function receiveRealtimeTyping(streamId: string, userId: string, typing: boolean, expiryMs = 6_000): void {
  const current = typingUsers.get(streamId) ?? new Map<string, ReturnType<typeof setTimeout>>();
  const previous = current.get(userId);
  if (previous) clearTimeout(previous);
  if (!typing) {
    current.delete(userId);
    if (!current.size) typingUsers.delete(streamId);
    notifyTyping(streamId);
    return;
  }
  const timer = setTimeout(() => {
    const latest = typingUsers.get(streamId);
    if (!latest || latest.get(userId) !== timer) return;
    latest.delete(userId);
    if (!latest.size) typingUsers.delete(streamId);
    notifyTyping(streamId);
  }, expiryMs);
  current.set(userId, timer);
  typingUsers.set(streamId, current);
  notifyTyping(streamId);
}

export function subscribeRealtimeTyping(streamId: string, listener: TypingListener): () => void {
  const listeners = typingListeners.get(streamId) ?? new Set<TypingListener>();
  listeners.add(listener);
  typingListeners.set(streamId, listeners);
  listener(currentTypingUsers(streamId));
  return () => {
    listeners.delete(listener);
    if (!listeners.size) typingListeners.delete(streamId);
  };
}

export function currentTypingUsers(streamId: string): readonly string[] {
  return [...(typingUsers.get(streamId)?.keys() ?? [])];
}

function emitJoin(streamId: string): void {
  commandSocket?.emit("stream:join", { streamId }, (accepted) => {
    if (!accepted) clearStreamTyping(streamId);
  });
}

function clearStreamTyping(streamId: string): void {
  const users = typingUsers.get(streamId);
  if (!users) return;
  for (const timer of users.values()) clearTimeout(timer);
  typingUsers.delete(streamId);
  notifyTyping(streamId);
}

function clearAllTyping(): void {
  const streams = [...typingUsers.keys()];
  for (const streamId of streams) clearStreamTyping(streamId);
}

function notifyTyping(streamId: string): void {
  const snapshot = currentTypingUsers(streamId);
  for (const listener of typingListeners.get(streamId) ?? []) listener(snapshot);
}

export const realtimeBridgeInternals = {
  reset(): void {
    commandSocket = null;
    requestedStreams.clear();
    clearAllTyping();
    typingListeners.clear();
  },
};
