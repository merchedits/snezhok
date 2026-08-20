import type { CallUpdatePayload } from "@snezhok/contracts";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { api } from "../infrastructure/http/apiClient";
import { navigationRef } from "../navigation/navigationRef";
import { dismissCallNotification } from "../notifications/androidNotifications";
import { bindCallUpdateHandler } from "./callSessionBridge";
import type { IncomingCallViewModel } from "./IncomingCallOverlay";

interface IncomingCall extends IncomingCallViewModel {
  streamId: string;
  startedAt: number;
}

interface UseIncomingCallControllerInput {
  phase: string;
  meId: string | undefined;
  notificationsEnabled: boolean;
  conversations: readonly { id: string; muted?: boolean }[];
  hasActiveSession: () => boolean;
  onCallEnded: (callId: string) => void;
}

/** Owns the short-lived incoming-call projection and notification routing. */
export function useIncomingCallController({
  phase,
  meId,
  notificationsEnabled,
  conversations,
  hasActiveSession,
  onCallEnded,
}: UseIncomingCallControllerInput) {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);

  const handleCallUpdate = useCallback((payload: CallUpdatePayload) => {
    if (payload.state === "ended") {
      setIncoming((current) => current?.roomId === payload.roomId ? null : current);
      onCallEnded(payload.roomId);
      return;
    }
    if (
      phase !== "ready"
      || !payload.streamId
      || !payload.callerId
      || payload.callerId === meId
      || payload.streamKind === "channel"
      || !notificationsEnabled
      || conversations.some((conversation) => conversation.id === payload.streamId && conversation.muted)
    ) return;
    const startedAt = payload.startedAt ?? Date.now();
    if (Date.now() - startedAt > 90_000 || AppState.currentState !== "active" || hasActiveSession()) return;
    setIncoming((current) => current?.roomId === payload.roomId ? current : {
      roomId: payload.roomId,
      streamId: payload.streamId!,
      startedAt,
      callerName: payload.callerName ?? "Snezhok",
      title: payload.title ?? payload.callerName ?? "Snezhok",
    });
  }, [conversations, hasActiveSession, meId, notificationsEnabled, onCallEnded, phase]);

  useEffect(() => {
    bindCallUpdateHandler(handleCallUpdate);
    return () => bindCallUpdateHandler(null);
  }, [handleCallUpdate]);

  useEffect(() => {
    if (!incoming) return;
    const remaining = Math.max(0, incoming.startedAt + 90_000 - Date.now());
    const timer = setTimeout(() => setIncoming((current) => current?.roomId === incoming.roomId ? null : current), remaining);
    return () => clearTimeout(timer);
  }, [incoming]);

  useEffect(() => {
    if (phase !== "ready") setIncoming(null);
  }, [phase]);

  const answerIncoming = useCallback((video: boolean) => {
    const target = incoming;
    if (!target) return;
    setIncoming(null);
    void dismissCallNotification(target.roomId).catch(() => undefined);
    if (navigationRef.isReady()) {
      navigationRef.navigate("Call", {
        streamId: target.streamId,
        title: target.title,
        startWithVideo: video,
        expectedCallId: target.roomId,
      });
    }
  }, [incoming]);

  const declineIncoming = useCallback(() => {
    const target = incoming;
    if (!target) return;
    setIncoming(null);
    void Promise.all([
      api.declineCall(target.roomId).catch(() => undefined),
      dismissCallNotification(target.roomId).catch(() => undefined),
    ]);
  }, [incoming]);

  const dismissIncoming = useCallback(() => setIncoming(null), []);

  return {
    incoming,
    answerIncoming,
    declineIncoming,
    dismissIncoming,
  };
}
