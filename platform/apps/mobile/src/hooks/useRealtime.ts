import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import { io, type Socket } from "socket.io-client";

import type { ClientToServerEvents, DurableEventEnvelope, ServerToClientEvents } from "@snezhok/contracts";

import { receiveCallUpdate } from "../calls/callSessionBridge";
import { recordDiagnostic } from "../diagnostics/diagnostics";
import { API_URL } from "../infrastructure/http/apiConfig";
import { readSession } from "../lib/secureSession";
import { bootstrapInvalidationEvents } from "../lib/realtimeInvalidation";
import { decodeRealtimeEvent, type ServerEventName, type ServerEventPayload } from "../infrastructure/realtime/realtimeEventDecoder";
import { SyncEngine } from "../domains/sync/syncEngine";
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
  const applyAttachmentLifecycle = useAppStore((state) => state.applyAttachmentLifecycle);
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
    let receivedEnvelope = false;
    const applyDurableEvent = async (event: DurableEventEnvelope) => {
      switch (event.name) {
        case "message:created":
          applyMessage(event.payload, "created");
          if (!event.payload.silent) void notifyIncomingMessage(event.payload).catch((error: unknown) => recordDiagnostic("warn", "notifications", "Message notification failed", { errorName: diagnosticErrorName(error) }));
          break;
        case "message:updated": applyMessage(event.payload, "updated"); break;
        case "attachment:updated": applyAttachmentLifecycle(event.payload); break;
        case "message:deleted": applyMessageDeleted(event.payload); break;
        case "read:updated": applyReadReceipt(event.payload); break;
        case "conversation:updated": applyConversation(event.payload); break;
        case "conversation:removed": removeConversation(event.payload.id); break;
        case "presence:updated": applyPresence(event.payload.userId, event.payload.presence, event.payload.lastSeenAt); break;
        case "call:updated":
          receiveCallUpdate(event.payload);
          void handleCallUpdate(event.payload).catch((error: unknown) => recordDiagnostic("warn", "notifications", "Call notification failed", { errorName: diagnosticErrorName(error) }));
          break;
        default:
          // Dormant projections are reconciled by one bounded authoritative
          // snapshot. Await it so the envelope cannot be acknowledged first.
          await refreshBootstrap({ force: true, silent: true });
      }
    };
    const syncEngine = new SyncEngine({
      getCursor: () => useAppStore.getState().eventCursor,
      apply: applyDurableEvent,
      commitCursor: setEventCursor,
      recover: async (event, error) => {
        recordDiagnostic("error", "network", "Durable event projection failed", {
          cursor: event.cursor,
          name: event.name,
          errorName: diagnosticErrorName(error),
        });
        await refreshBootstrap({ force: true, silent: true });
      },
    });
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
        auth: { token: session.accessToken, eventEnvelopeVersion: 1 },
        reconnectionDelay: 500,
        reconnectionDelayMax: 8_000,
        reconnectionAttempts: Infinity,
        randomizationFactor: 0.5,
        timeout: 10_000,
      });
      socket.on("connect", () => {
        receivedEnvelope = false;
        syncEngine.resume();
        synchronizePush();
        rejoinRequestedStreams();
        socket?.emit("sync:resume", { cursor: useAppStore.getState().eventCursor }, (accepted) => {
          if (!accepted) void refreshBootstrap({ force: true, silent: true });
        });
      });
      const receiveDurable = (event: DurableEventEnvelope) => {
        receivedEnvelope = true;
        void syncEngine.accept(event).catch((error: unknown) => recordDiagnostic("error", "network", "Realtime synchronization paused", { errorName: diagnosticErrorName(error) }));
      };
      onValidated(socket, "sync:event", receiveDurable);
      onValidated(socket, "sync:ready", ({ cursor }) => { if (!receivedEnvelope) setEventCursor(cursor); });
      onValidated(socket, "message:created", (message) => {
        applyMessage(message, "created");
        if (!message.silent) void notifyIncomingMessage(message).catch((error: unknown) => recordDiagnostic("warn", "notifications", "Message notification failed", { errorName: diagnosticErrorName(error) }));
      });
      onValidated(socket, "message:updated", (message) => applyMessage(message, "updated"));
      onValidated(socket, "attachment:updated", applyAttachmentLifecycle);
      onValidated(socket, "call:updated", (payload) => {
        receiveCallUpdate(payload);
        void handleCallUpdate(payload).catch((error: unknown) => recordDiagnostic("warn", "notifications", "Call notification failed", { errorName: diagnosticErrorName(error) }));
      });
      onValidated(socket, "message:deleted", applyMessageDeleted);
      onValidated(socket, "read:updated", applyReadReceipt);
      onValidated(socket, "conversation:updated", applyConversation);
      onValidated(socket, "conversation:removed", ({ id }) => removeConversation(id));
      for (const event of bootstrapInvalidationEvents) onValidated(socket, event, () => {
        void refreshBootstrap({ force: true, silent: true }).catch(() => undefined);
      });
      onValidated(socket, "presence:updated", ({ userId, presence, lastSeenAt }) => applyPresence(userId, presence, lastSeenAt));
      onValidated(socket, "typing:updated", ({ streamId, userId, typing }) => receiveRealtimeTyping(streamId, userId, typing));
      onValidated(socket, "activity:drawing:updated", ({ activityId, sequence, strokes }) => receiveRealtimeDrawing(activityId, sequence, strokes));
      socket.io.on("reconnect_attempt", () => {
        void readSession().then((latest) => {
        if (socket && latest) socket.auth = { token: latest.accessToken, eventEnvelopeVersion: 1 };
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
  }, [applyAttachmentLifecycle, applyConversation, applyMessage, applyMessageDeleted, applyPresence, applyReadReceipt, enabled, refreshBootstrap, removeConversation, setEventCursor]);
}

function diagnosticErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name.slice(0, 80) : "UnknownError";
}

function onValidated<Name extends ServerEventName>(
  socket: RealtimeSocket,
  name: Name,
  listener: (payload: ServerEventPayload<Name>) => void,
): void {
  socket.on(name, ((payload: unknown) => {
    const decoded = decodeRealtimeEvent(name, payload);
    if (!decoded.success) {
      recordDiagnostic("error", "network", "Invalid realtime event", { name, issueCount: decoded.issueCount });
      return;
    }
    listener(decoded.data);
  }) as never);
}
