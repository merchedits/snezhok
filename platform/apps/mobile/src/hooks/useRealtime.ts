import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import { io, type Socket } from "socket.io-client";

import type { ClientToServerEvents, ServerToClientEvents } from "@snezhok/contracts";

import { receiveCallUpdate } from "../calls/callSessionBridge";
import { recordDiagnostic } from "../diagnostics/diagnostics";
import { API_URL } from "../lib/api";
import { readSession } from "../lib/secureSession";
import { bindBootstrapInvalidations } from "../lib/realtimeInvalidation";
import { bindRealtimeSocket, receiveRealtimeDrawing, receiveRealtimeTyping, rejoinRequestedStreams } from "../lib/realtimeBridge";
import {
  handleCallUpdate,
  handleNotificationResponse,
  initializeAndroidNotifications,
  handleRemoteNotification,
  notifyIncomingMessage,
  registerRemotePushDevice,
} from "../notifications/androidNotifications";
import { useAppStore } from "../store/useAppStore";

type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useRealtime(enabled: boolean): void {
  const applyMessage = useAppStore((state) => state.applyMessage);
  const applyMessageDeleted = useAppStore((state) => state.applyMessageDeleted);
  const applyReadReceipt = useAppStore((state) => state.applyReadReceipt);
  const applyConversation = useAppStore((state) => state.applyConversation);
  const removeConversation = useAppStore((state) => state.removeConversation);
  const applyPresence = useAppStore((state) => state.applyPresence);
  const refreshBootstrap = useAppStore((state) => state.refreshBootstrap);
  const setEventCursor = useAppStore((state) => state.setEventCursor);

  useEffect(() => {
    if (!enabled) return;
    let socket: RealtimeSocket | null = null;
    let disposed = false;
    const synchronizePush = () => { void initializeAndroidNotifications().then(() => registerRemotePushDevice()); };
    synchronizePush();
    // Expo push tokens can change while an install remains signed in. Refresh
    // the durable server registration whenever Android brings the app back to
    // the foreground; registration is internally coalesced and idempotent.
    const appState = AppState.addEventListener("change", (state) => { if (state === "active") synchronizePush(); });
    const notificationResponse = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    const notificationReceived = Notifications.addNotificationReceivedListener((notification) => { void handleRemoteNotification(notification); });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && !disposed) handleNotificationResponse(response);
    }).catch(() => undefined);

    void readSession().then((session) => {
      if (disposed || !session) return;
      const origin = new URL(API_URL).origin;
      socket = io(origin, {
        path: "/chat/socket.io",
        transports: ["websocket", "polling"],
        auth: { token: session.accessToken },
        reconnectionDelay: 500,
        reconnectionDelayMax: 8_000,
        reconnectionAttempts: Infinity,
        randomizationFactor: 0.5,
        timeout: 10_000,
      });
      socket.on("connect", () => {
        synchronizePush();
        rejoinRequestedStreams();
        socket?.emit("sync:resume", { cursor: useAppStore.getState().eventCursor }, (accepted) => {
          if (!accepted) void refreshBootstrap({ force: true, silent: true });
        });
      });
      socket.on("sync:ready", ({ cursor }) => setEventCursor(cursor));
      socket.on("message:created", (message) => {
        applyMessage(message, "created");
        if (!message.silent) void notifyIncomingMessage(message).catch((error: unknown) => recordDiagnostic("warn", "notifications", "Message notification failed", { errorName: diagnosticErrorName(error) }));
      });
      socket.on("message:updated", (message) => applyMessage(message, "updated"));
      socket.on("call:updated", (payload) => {
        receiveCallUpdate(payload);
        void handleCallUpdate(payload).catch((error: unknown) => recordDiagnostic("warn", "notifications", "Call notification failed", { errorName: diagnosticErrorName(error) }));
      });
      socket.on("message:deleted", applyMessageDeleted);
      socket.on("read:updated", applyReadReceipt);
      socket.on("conversation:updated", applyConversation);
      socket.on("conversation:removed", ({ id }) => removeConversation(id));
      bindBootstrapInvalidations(socket as unknown as Parameters<typeof bindBootstrapInvalidations>[0], () => {
        void refreshBootstrap({ force: true, silent: true }).catch(() => undefined);
      });
      socket.on("presence:updated", ({ userId, presence, lastSeenAt }) => applyPresence(userId, presence, lastSeenAt));
      socket.on("typing:updated", ({ streamId, userId, typing }) => receiveRealtimeTyping(streamId, userId, typing));
      socket.on("activity:drawing:updated", ({ activityId, sequence, strokes }) => receiveRealtimeDrawing(activityId, sequence, strokes));
      socket.io.on("reconnect_attempt", () => {
        void readSession().then((latest) => {
          if (socket && latest) socket.auth = { token: latest.accessToken };
        });
      });
      bindRealtimeSocket(socket);
    });

    return () => {
      disposed = true;
      notificationResponse.remove();
      notificationReceived.remove();
      appState.remove();
      bindRealtimeSocket(null);
      socket?.disconnect();
    };
  }, [applyConversation, applyMessage, applyMessageDeleted, applyPresence, applyReadReceipt, enabled, refreshBootstrap, removeConversation, setEventCursor]);
}

function diagnosticErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name.slice(0, 80) : "UnknownError";
}
