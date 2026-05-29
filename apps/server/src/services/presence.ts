// Simple in-memory storage for online user sockets
// userId -> Set of socketIds
const onlineUsers = new Map<string, Set<string>>();
// socketId -> userId
const socketToUser = new Map<string, string>();

// typingUsers: messageRoom -> Set of userIds
const typingUsers = new Map<string, Set<string>>();

export function setOnline(userId: string, socketId: string) {
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId)!.add(socketId);
  socketToUser.set(socketId, userId);
}

export function setOffline(socketId: string): { userId: string; wasLastSocket: boolean } | null {
  const userId = socketToUser.get(socketId);
  if (!userId) return null;

  socketToUser.delete(socketId);
  const sockets = onlineUsers.get(userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) {
      onlineUsers.delete(userId);
      return { userId, wasLastSocket: true };
    }
  }

  return { userId, wasLastSocket: false };
}

export function getUserIdBySocket(socketId: string): string | null {
  return socketToUser.get(socketId) || null;
}

export function getSocketsByUser(userId: string): string[] {
  const sockets = onlineUsers.get(userId);
  return sockets ? Array.from(sockets) : [];
}

export function getOnlineUsers(): string[] {
  return Array.from(onlineUsers.keys());
}

export function setTyping(roomId: string, userId: string, isTyping: boolean) {
  if (!typingUsers.has(roomId)) {
    typingUsers.set(roomId, new Set());
  }

  const typers = typingUsers.get(roomId)!;
  if (isTyping) {
    typers.add(userId);
  } else {
    typers.delete(userId);
  }

  return Array.from(typers);
}

export function getTypers(roomId: string): string[] {
  const typers = typingUsers.get(roomId);
  return typers ? Array.from(typers) : [];
}
