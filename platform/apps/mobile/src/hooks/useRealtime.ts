import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";

import type { ClientToServerEvents, ServerToClientEvents } from "@snezhok/contracts";

import { API_URL } from "../lib/api";
import { readSession } from "../lib/secureSession";
import { useAppStore } from "../store/useAppStore";

type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useRealtime(enabled: boolean): void {
  const applyMessage = useAppStore((state) => state.applyMessage);
  const applyPresence = useAppStore((state) => state.applyPresence);
  const refreshBootstrap = useAppStore((state) => state.refreshBootstrap);
  const setEventCursor = useAppStore((state) => state.setEventCursor);

  useEffect(() => {
    if (!enabled) return;
    let socket: RealtimeSocket | null = null;
    let disposed = false;

    void readSession().then((session) => {
      if (disposed || !session) return;
      const origin = new URL(API_URL).origin;
      socket = io(origin, {
        path: "/chat/socket.io",
        transports: ["websocket"],
        auth: { token: session.accessToken },
        reconnectionDelay: 500,
        reconnectionDelayMax: 8_000,
      });
      socket.on("connect", () => {
        socket?.emit("sync:resume", { cursor: useAppStore.getState().eventCursor }, (accepted) => {
          if (!accepted) void refreshBootstrap();
        });
      });
      socket.on("sync:ready", ({ cursor }) => setEventCursor(cursor));
      socket.on("message:created", applyMessage);
      socket.on("message:updated", applyMessage);
      socket.on("conversation:updated", () => void refreshBootstrap());
      socket.on("channel:updated", () => void refreshBootstrap());
      socket.on("friend:updated", () => void refreshBootstrap());
      socket.on("presence:updated", ({ userId, presence, lastSeenAt }) => applyPresence(userId, presence, lastSeenAt));
      socket.io.on("reconnect_attempt", () => {
        void readSession().then((latest) => {
          if (socket && latest) socket.auth = { token: latest.accessToken };
        });
      });
    });

    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, [applyMessage, applyPresence, enabled, refreshBootstrap, setEventCursor]);
}
