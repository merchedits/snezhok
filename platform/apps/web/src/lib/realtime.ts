import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@snezhok/contracts";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function getRealtimeSocket(): AppSocket {
  if (socket) return socket;
  const appBase = import.meta.env.BASE_URL.replace(/\/$/, "");
  socket = io(import.meta.env.VITE_SOCKET_URL || window.location.origin, {
    path: import.meta.env.VITE_SOCKET_PATH || `${appBase}/socket.io`,
    autoConnect: false,
    withCredentials: true,
    transports: ["websocket", "polling"],
  });
  return socket;
}

export function closeRealtimeSocket() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}
