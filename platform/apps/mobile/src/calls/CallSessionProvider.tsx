import { AudioSession } from "@livekit/react-native";
import type { CallUpdatePayload } from "@snezhok/contracts";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import { ConnectionState, Room, RoomEvent, Track } from "livekit-client";

import { recordDiagnostic } from "../diagnostics/diagnostics";
import { useTranslation } from "../i18n";
import { api } from "../lib/api";
import { availableAudioRoutes, preferredAudioOutputs, type CallAudioRoute } from "../lib/callAudioRoute";
import { classifyCallFailure } from "../lib/callDiagnostics";
import { callMediaProfile } from "../lib/callQuality";
import { navigationRef } from "../navigation/navigationRef";
import { dismissCallNotification } from "../notifications/androidNotifications";
import { useAppStore } from "../store/useAppStore";
import type { CallJoinResponse } from "../types";
import { CompactCallBar } from "./CompactCallBar";
import { IncomingCallOverlay, type IncomingCallViewModel } from "./IncomingCallOverlay";
import { bindCallUpdateHandler } from "./callSessionBridge";
import { callCopy } from "./callStrings";
import { parseCallStats, type CallNetworkStats, type CallStatsBaseline } from "./callStats";
import { startCallForegroundService, stopCallForegroundService, updateCallForegroundService } from "./callForegroundService";

export type CallKind = "direct" | "group" | "voice";
export type CallSessionStatus = "connecting" | "connected" | "reconnecting";

export interface ActiveCallSession {
  streamId: string;
  title: string;
  callId: string | null;
  roomName: string | null;
  kind: CallKind;
  canEnd: boolean;
  status: CallSessionStatus;
  startedAt: number;
  reconnects: number;
  audioRoutes: Exclude<CallAudioRoute, "auto">[];
  audioRoute: Exclude<CallAudioRoute, "auto"> | null;
  stats: CallNetworkStats;
}

interface StartCallInput {
  streamId: string;
  title: string;
  startWithVideo?: boolean;
}

interface CallSessionContextValue {
  room: Room | null;
  session: ActiveCallSession | null;
  startCall(input: StartCallInput): Promise<void>;
  leaveCall(options?: { endForEveryone?: boolean }): Promise<void>;
  toggleMicrophone(): Promise<void>;
  setAudioRoute(route: Exclude<CallAudioRoute, "auto">): Promise<void>;
  setCallScreenVisible(visible: boolean): void;
  answerIncoming(video: boolean): void;
  declineIncoming(): void;
}

const emptyStats: CallNetworkStats = { pingMs: null, jitterMs: null, packetLossPercent: null, inboundKbps: 0, outboundKbps: 0, codecs: [], sampledAt: 0 };
const CallSessionContext = createContext<CallSessionContextValue | null>(null);

export class ActiveCallConflictError extends Error {
  constructor() {
    super("ACTIVE_CALL_CONFLICT");
    this.name = "ActiveCallConflictError";
  }
}

export function CallSessionProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const phase = useAppStore((state) => state.phase);
  const me = useAppStore((state) => state.me);
  const conversations = useAppStore((state) => state.conversations);
  const channels = useAppStore((state) => state.channels);
  const language = settings.language;
  const copy = callCopy(language);
  const [room, setRoom] = useState<Room | null>(null);
  const [session, setSession] = useState<ActiveCallSession | null>(null);
  const [incoming, setIncoming] = useState<(IncomingCallViewModel & { streamId: string; startedAt: number }) | null>(null);
  const [callScreenVisible, setCallScreenVisible] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const sessionRef = useRef<ActiveCallSession | null>(null);
  const startOperation = useRef<{ streamId: string; promise: Promise<void> } | null>(null);
  const cleanupOperation = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const audioStarted = useRef(false);
  const listenerCleanup = useRef<(() => void) | null>(null);
  const statsBaseline = useRef<CallStatsBaseline | undefined>(undefined);

  const updateSession = useCallback((transform: (current: ActiveCallSession) => ActiveCallSession) => {
    setSession((current) => {
      if (!current) return null;
      const next = transform(current);
      sessionRef.current = next;
      return next;
    });
  }, []);

  const clearLocalCall = useCallback(async ({ notifyServer, endForEveryone = false }: { notifyServer: boolean; endForEveryone?: boolean }) => {
    if (cleanupOperation.current) return cleanupOperation.current;
    const current = sessionRef.current;
    const currentRoom = roomRef.current;
    if (!current && !currentRoom) return;
    generation.current += 1;
    listenerCleanup.current?.();
    listenerCleanup.current = null;
    sessionRef.current = null;
    roomRef.current = null;
    setSession(null);
    setRoom(null);
    setCallScreenVisible(false);
    statsBaseline.current = undefined;
    stopCallForegroundService();

    const operation = (async () => {
      await currentRoom?.disconnect().catch(() => undefined);
      if (audioStarted.current) {
        audioStarted.current = false;
        await AudioSession.stopAudioSession().catch(() => undefined);
      }
      if (!notifyServer || !current?.callId) return;
      await retryCallLifecycle(endForEveryone ? () => api.endCall(current.callId!) : () => api.leaveCall(current.callId!));
    })().finally(() => { cleanupOperation.current = null; });
    cleanupOperation.current = operation;
    return operation;
  }, []);

  const attachRoomListeners = useCallback((nextRoom: Room, currentGeneration: number) => {
    const active = () => generation.current === currentGeneration && roomRef.current === nextRoom;
    const onState = (state: ConnectionState) => {
      if (!active()) return;
      if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) updateSession((value) => ({ ...value, status: "reconnecting" }));
      else if (state === ConnectionState.Connected) updateSession((value) => ({ ...value, status: "connected" }));
    };
    const onReconnecting = () => {
      if (!active()) return;
      updateSession((value) => ({ ...value, status: "reconnecting", reconnects: value.reconnects + 1 }));
      recordDiagnostic("warn", "call", "LiveKit reconnecting", { connection: nextRoom.state });
    };
    const onReconnected = () => {
      if (!active()) return;
      updateSession((value) => ({ ...value, status: "connected" }));
      recordDiagnostic("info", "call", "LiveKit reconnected", { connection: nextRoom.state });
    };
    const onDisconnected = (reason?: unknown) => {
      if (!active()) return;
      recordDiagnostic("warn", "call", "LiveKit disconnected", { failure: classifyCallFailure(reason) });
      void clearLocalCall({ notifyServer: true });
    };
    const onMediaFailure = (failure?: unknown) => {
      if (!active()) return;
      recordDiagnostic("error", "call", "LiveKit media device failure", { failure: classifyCallFailure(failure) });
    };
    nextRoom.on(RoomEvent.ConnectionStateChanged, onState);
    nextRoom.on(RoomEvent.Reconnecting, onReconnecting);
    nextRoom.on(RoomEvent.Reconnected, onReconnected);
    nextRoom.on(RoomEvent.Disconnected, onDisconnected);
    nextRoom.on(RoomEvent.MediaDevicesError, onMediaFailure);
    listenerCleanup.current = () => {
      nextRoom.off(RoomEvent.ConnectionStateChanged, onState);
      nextRoom.off(RoomEvent.Reconnecting, onReconnecting);
      nextRoom.off(RoomEvent.Reconnected, onReconnected);
      nextRoom.off(RoomEvent.Disconnected, onDisconnected);
      nextRoom.off(RoomEvent.MediaDevicesError, onMediaFailure);
    };
  }, [clearLocalCall, updateSession]);

  const startCall = useCallback(async (input: StartCallInput) => {
    const activeSession = sessionRef.current;
    if (activeSession?.streamId === input.streamId && roomRef.current) {
      if (input.startWithVideo && !roomRef.current.localParticipant.isCameraEnabled) {
        if (await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA)) {
          await roomRef.current.localParticipant.setCameraEnabled(true);
          if (!updateCallForegroundService(activeSession.title, copy.active, true)) {
            await roomRef.current.localParticipant.setCameraEnabled(false).catch(() => undefined);
            throw new Error("CALL_FOREGROUND_SERVICE_UPDATE_FAILED");
          }
        }
      }
      return;
    }
    if (activeSession || (startOperation.current && startOperation.current.streamId !== input.streamId)) throw new ActiveCallConflictError();
    if (startOperation.current?.streamId === input.streamId) return startOperation.current.promise;

    const operation = (async () => {
      if (!(await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO))) throw new Error(t("microphonePermissionDenied"));
      const currentGeneration = ++generation.current;
      const kind = callKind(input.streamId, conversations, channels);
      const provisional: ActiveCallSession = {
        streamId: input.streamId, title: input.title, callId: null, roomName: null, kind, canEnd: false,
        status: "connecting", startedAt: Date.now(), reconnects: 0, audioRoutes: [], audioRoute: null, stats: emptyStats,
      };
      sessionRef.current = provisional;
      setSession(provisional);
      setIncoming(null);

      let credentials: CallJoinResponse | null = null;
      try {
        const preferred = preferredAudioOutputs(settings.callAudioRoute, settings.microphoneMode);
        await AudioSession.configureAudio({ android: { preferredOutputList: [...preferred], audioTypeOptions: { manageAudioFocus: true, audioMode: "inCommunication", audioFocusMode: "gain", audioStreamType: "voiceCall", audioAttributesUsageType: "voiceCommunication", audioAttributesContentType: "speech", forceHandleAudioRouting: true } } });
        await AudioSession.startAudioSession();
        audioStarted.current = true;
        const routes = availableAudioRoutes(await AudioSession.getAudioOutputs());
        const selectedRoute = preferred.find((candidate) => routes.includes(candidate)) ?? routes[0] ?? null;
        if (selectedRoute) await AudioSession.selectAudioOutput(selectedRoute);

        credentials = await api.joinCall(input.streamId);
        if (generation.current !== currentGeneration) {
          // The user left while token creation was in flight. Do not strand a
          // direct call session until LiveKit's room timeout.
          await api.leaveCall(credentials.callId).catch(() => undefined);
          return;
        }
        const profile = callMediaProfile(settings.callQuality, settings.screenShareQuality);
        const nextRoom = new Room({
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: {
            simulcast: profile.simulcast,
            videoCodec: "vp8",
            audioPreset: { maxBitrate: profile.audioBitrate },
            videoEncoding: { maxBitrate: profile.camera.maxBitrate, maxFramerate: profile.camera.frameRate },
            screenShareEncoding: { maxBitrate: profile.screen.maxBitrate, maxFramerate: profile.screen.frameRate },
          },
        });
        roomRef.current = nextRoom;
        setRoom(nextRoom);
        const connectedSession: ActiveCallSession = { ...provisional, callId: credentials.callId, roomName: credentials.roomName, canEnd: credentials.canEnd, audioRoutes: routes, audioRoute: selectedRoute };
        sessionRef.current = connectedSession;
        setSession(connectedSession);
        attachRoomListeners(nextRoom, currentGeneration);
        // Start with the microphone service type. Android only permits adding
        // the camera type after CAMERA permission has been granted in the
        // foreground.
        if (Platform.OS === "android" && !startCallForegroundService(input.title, copy.active, false)) {
          throw new Error("CALL_FOREGROUND_SERVICE_UNAVAILABLE");
        }
        await withCallSetupTimeout(
          nextRoom.connect(credentials.url, credentials.token, { maxRetries: 5, websocketTimeout: 15_000, peerConnectionTimeout: 20_000, rtcConfig: { iceTransportPolicy: "all" } }),
          28_000,
        );
        if (generation.current !== currentGeneration) return;
        if (canPublishSource(nextRoom, Track.Source.Microphone)) {
          await nextRoom.localParticipant.setMicrophoneEnabled(true, {
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression !== "off",
            autoGainControl: settings.autoGainControl,
          });
        }
        if (input.startWithVideo && canPublishSource(nextRoom, Track.Source.Camera) && await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA)) {
          await nextRoom.localParticipant.setCameraEnabled(true, { resolution: { width: profile.camera.width, height: profile.camera.height, frameRate: profile.camera.frameRate }, frameRate: profile.camera.frameRate }, { videoEncoding: { maxBitrate: profile.camera.maxBitrate, maxFramerate: profile.camera.frameRate }, simulcast: profile.simulcast }).then(async () => {
            if (!updateCallForegroundService(input.title, copy.active, true)) {
              await nextRoom.localParticipant.setCameraEnabled(false).catch(() => undefined);
              throw new Error("CALL_FOREGROUND_SERVICE_UPDATE_FAILED");
            }
          }).catch((error) => {
            recordDiagnostic("warn", "call", "Initial camera publication failed", { failure: classifyCallFailure(error) });
          });
        }
        updateSession((value) => ({ ...value, status: "connected" }));
        recordDiagnostic("info", "call", "LiveKit call connected", { kind, connection: nextRoom.state });
      } catch (error) {
        recordDiagnostic("error", "call", "Call setup failed", { failure: classifyCallFailure(error) });
        if (credentials && generation.current === currentGeneration) {
          const failed = sessionRef.current;
          if (failed) await clearLocalCall({ notifyServer: true });
        } else if (generation.current === currentGeneration) {
          await clearLocalCall({ notifyServer: false });
        }
        throw error;
      }
    })().finally(() => {
      if (startOperation.current?.promise === operation) startOperation.current = null;
    });
    startOperation.current = { streamId: input.streamId, promise: operation };
    return operation;
  }, [attachRoomListeners, channels, clearLocalCall, conversations, copy.active, settings, t, updateSession]);

  const leaveCall = useCallback((options?: { endForEveryone?: boolean }) => clearLocalCall({ notifyServer: true, ...(options?.endForEveryone === undefined ? {} : { endForEveryone: options.endForEveryone }) }), [clearLocalCall]);

  const toggleMicrophone = useCallback(async () => {
    const activeRoom = roomRef.current;
    const activeSession = sessionRef.current;
    if (!activeRoom || !activeSession) return;
    const enable = !activeRoom.localParticipant.isMicrophoneEnabled;
    if (enable && !(await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO))) throw new Error(t("microphonePermissionDenied"));
    await activeRoom.localParticipant.setMicrophoneEnabled(enable, enable ? {
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression !== "off",
      autoGainControl: settings.autoGainControl,
    } : undefined);
    updateCallForegroundService(activeSession.title, copy.active, activeRoom.localParticipant.isCameraEnabled);
    // Participant hooks receive the LiveKit event; refresh the compact bar too.
    updateSession((value) => ({ ...value }));
  }, [copy.active, settings.autoGainControl, settings.echoCancellation, settings.noiseSuppression, t, updateSession]);

  const setAudioRoute = useCallback(async (route: Exclude<CallAudioRoute, "auto">) => {
    if (!sessionRef.current) return;
    await AudioSession.selectAudioOutput(route);
    updateSession((value) => ({ ...value, audioRoute: route }));
  }, [updateSession]);

  const handleCallUpdate = useCallback((payload: CallUpdatePayload) => {
    if (payload.state === "ended") {
      setIncoming((current) => current?.roomId === payload.roomId ? null : current);
      if (sessionRef.current?.callId === payload.roomId) void clearLocalCall({ notifyServer: false });
      return;
    }
    if (phase !== "ready" || !payload.streamId || !payload.callerId || payload.callerId === me?.id || payload.streamKind === "channel") return;
    if (settings.callNotifications === false || conversations.find((item) => item.id === payload.streamId)?.muted) return;
    const startedAt = payload.startedAt ?? Date.now();
    if (Date.now() - startedAt > 90_000 || AppState.currentState !== "active") return;
    if (sessionRef.current) return;
    setIncoming((current) => current?.roomId === payload.roomId ? current : {
      roomId: payload.roomId,
      streamId: payload.streamId!,
      startedAt,
      callerName: payload.callerName ?? "Snezhok",
      title: payload.title ?? payload.callerName ?? "Snezhok",
    });
  }, [clearLocalCall, conversations, me?.id, phase, settings.callNotifications]);

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
    if (phase === "ready" || (!sessionRef.current && !roomRef.current)) return;
    void clearLocalCall({ notifyServer: true });
  }, [clearLocalCall, phase]);

  useEffect(() => {
    if (phase !== "ready") setIncoming(null);
  }, [phase]);

  useEffect(() => {
    if (!room) return;
    let disposed = false;
    const sample = async () => {
      const reports = await collectRoomStats(room);
      if (disposed || roomRef.current !== room) return;
      const parsed = parseCallStats(reports, statsBaseline.current);
      statsBaseline.current = parsed.baseline;
      updateSession((current) => ({ ...current, stats: parsed.stats }));
    };
    const interval = setInterval(() => { void sample(); }, 3_000);
    void sample();
    return () => { disposed = true; clearInterval(interval); };
  }, [room, updateSession]);

  const answerIncoming = useCallback((video: boolean) => {
    const target = incoming;
    if (!target) return;
    setIncoming(null);
    void dismissCallNotification(target.roomId).catch(() => undefined);
    if (navigationRef.isReady()) navigationRef.navigate("Call", { streamId: target.streamId, title: target.title, startWithVideo: video });
  }, [incoming]);

  const declineIncoming = useCallback(() => {
    const target = incoming;
    if (!target) return;
    setIncoming(null);
    void Promise.all([api.declineCall(target.roomId).catch(() => undefined), dismissCallNotification(target.roomId).catch(() => undefined)]);
  }, [incoming]);

  const openCurrentCall = useCallback(() => {
    const active = sessionRef.current;
    if (!active || !navigationRef.isReady()) return;
    navigationRef.navigate("Call", { streamId: active.streamId, title: active.title });
  }, []);

  const value = useMemo<CallSessionContextValue>(() => ({ room, session, startCall, leaveCall, toggleMicrophone, setAudioRoute, setCallScreenVisible, answerIncoming, declineIncoming }), [answerIncoming, declineIncoming, leaveCall, room, session, setAudioRoute, startCall, toggleMicrophone]);
  return <CallSessionContext.Provider value={value}>
    {children}
    <IncomingCallOverlay call={phase === "ready" ? incoming : null} language={language} onAnswer={answerIncoming} onDecline={declineIncoming} />
    <CompactCallBar
      visible={Boolean(session && room && !callScreenVisible)}
      title={session?.title ?? "Snezhok"}
      language={language}
      microphoneEnabled={room?.localParticipant.isMicrophoneEnabled ?? false}
      reconnecting={session?.status === "reconnecting"}
      onOpen={openCurrentCall}
      onToggleMicrophone={() => { void toggleMicrophone().catch(() => undefined); }}
      onLeave={() => { void leaveCall(); }}
    />
  </CallSessionContext.Provider>;
}

export function useCallSession(): CallSessionContextValue {
  const value = useContext(CallSessionContext);
  if (!value) throw new Error("useCallSession must be used inside CallSessionProvider");
  return value;
}

async function requestAndroidPermission(permission: typeof PermissionsAndroid.PERMISSIONS.CAMERA | typeof PermissionsAndroid.PERMISSIONS.RECORD_AUDIO): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (await PermissionsAndroid.check(permission)) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

function callKind(streamId: string, conversations: readonly { id: string; kind: "direct" | "group" }[], channels: readonly { id: string }[]): CallKind {
  const conversation = conversations.find((item) => item.id === streamId);
  if (conversation) return conversation.kind;
  return channels.some((item) => item.id === streamId) ? "voice" : "direct";
}

async function collectRoomStats(room: Room): Promise<unknown[]> {
  const tracks = [
    ...room.localParticipant.trackPublications.values(),
    ...[...room.remoteParticipants.values()].flatMap((participant) => [...participant.trackPublications.values()]),
  ];
  return (await Promise.all(tracks.map(async (publication) => {
    const track = publication.track;
    if (!track || !("getRTCStatsReport" in track) || typeof track.getRTCStatsReport !== "function") return null;
    return track.getRTCStatsReport().catch(() => undefined);
  }))).filter(Boolean) as unknown[];
}

async function retryCallLifecycle(operation: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      if (attempt === 2) {
        recordDiagnostic("warn", "call", "Call lifecycle acknowledgement failed", { errorName: error instanceof Error ? error.name.slice(0, 80) : "UnknownError" });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 250 : 1_000));
    }
  }
}

/** Prevent an unavailable signaling or ICE path from leaving the call screen
 * indefinitely on "Connecting". Room cleanup in the caller remains the
 * single authority for audio focus, foreground service and server lifecycle. */
function withCallSetupTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("CALL_CONNECTION_TIMEOUT")), timeoutMs);
    void operation.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });
}

export function canPublishSource(room: Room, source: Track.Source): boolean {
  const permissions = room.localParticipant.permissions;
  if (!permissions?.canPublish) return false;
  const expected = source === Track.Source.Camera ? 1
    : source === Track.Source.Microphone ? 2
      : source === Track.Source.ScreenShare ? 3
        : source === Track.Source.ScreenShareAudio ? 4
          : 0;
  return permissions.canPublishSources.length === 0 || permissions.canPublishSources.some((allowed) => Number(allowed) === expected);
}
