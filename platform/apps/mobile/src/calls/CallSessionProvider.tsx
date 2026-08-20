import { AudioSession } from "@livekit/react-native";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import { ConnectionState, Room, RoomEvent, Track } from "livekit-client";

import { recordDiagnostic } from "../diagnostics/diagnostics";
import { useTranslation } from "../i18n";
import { api } from "../infrastructure/http/apiClient";
import { availableAudioRoutes, preferredAudioOutputs, type CallAudioRoute } from "../lib/callAudioRoute";
import { classifyCallFailure } from "../lib/callDiagnostics";
import { callMediaProfile } from "../lib/callQuality";
import { navigationRef } from "../navigation/navigationRef";
import { useAppStore } from "../store/useAppStore";
import type { CallJoinResponse } from "../types";
import { stopVoicePlayback } from "../lib/voicePlaybackCoordinator";
import { claimAudioSession, ownsAudioSession, releaseAudioSession, runAudioSessionOperation, type AudioSessionLease } from "../lib/audioSessionOwnership";
import { CompactCallBar } from "./CompactCallBar";
import { IncomingCallOverlay } from "./IncomingCallOverlay";
import { callCopy } from "./callStrings";
import type { CallNetworkStats } from "./callStats";
import { mayPublishSource } from "./callPublishPermissions";
import { startCallForegroundService, stopCallForegroundService, updateCallForegroundService } from "./callForegroundService";
import { useIncomingCallController } from "./useIncomingCallController";
import { useCallStatsSampler } from "./useCallStatsSampler";

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
  expectedCallId?: string;
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

const emptyStats: CallNetworkStats = { pingMs: null, jitterMs: null, packetLossPercent: null, inboundKbps: 0, outboundKbps: 0, codecs: [], iceCandidateType: null, transportProtocol: null, sampledAt: 0 };
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
  const callsEnabled = useAppStore((state) => state.capabilities.calls);
  const phase = useAppStore((state) => state.phase);
  const me = useAppStore((state) => state.me);
  const conversations = useAppStore((state) => state.conversations);
  const channels = useAppStore((state) => state.channels);
  const language = settings.language;
  const copy = callCopy(language);
  const [room, setRoom] = useState<Room | null>(null);
  const [session, setSession] = useState<ActiveCallSession | null>(null);
  const [callScreenVisible, setCallScreenVisible] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const sessionRef = useRef<ActiveCallSession | null>(null);
  const startOperation = useRef<{ streamId: string; promise: Promise<void> } | null>(null);
  const cleanupOperation = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const audioStarted = useRef(false);
  const audioLease = useRef<AudioSessionLease | null>(null);
  const listenerCleanup = useRef<(() => void) | null>(null);

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
    stopCallForegroundService();

    const operation = (async () => {
      await currentRoom?.disconnect().catch(() => undefined);
      const lease = audioLease.current;
      audioLease.current = null;
      await releaseAudioSession(lease, async () => {
        if (!audioStarted.current) return;
        audioStarted.current = false;
        await AudioSession.stopAudioSession().catch(() => undefined);
      }).catch(() => false);
      if (!notifyServer || !current?.callId) return;
      await retryCallLifecycle(endForEveryone ? () => api.endCall(current.callId!) : () => api.leaveCall(current.callId!));
    })().finally(() => { cleanupOperation.current = null; });
    cleanupOperation.current = operation;
    return operation;
  }, []);

  const hasActiveSession = useCallback(() => Boolean(sessionRef.current), []);
  const onRemoteCallEnded = useCallback((callId: string) => {
    if (sessionRef.current?.callId === callId) void clearLocalCall({ notifyServer: false });
  }, [clearLocalCall]);
  const { incoming, answerIncoming, declineIncoming, dismissIncoming } = useIncomingCallController({
    phase,
    meId: me?.id,
    notificationsEnabled: settings.callNotifications !== false,
    conversations,
    hasActiveSession,
    onCallEnded: onRemoteCallEnded,
  });

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
    if (!callsEnabled) throw new Error("CALLS_DISABLED");
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
      // expo-audio and LiveKit both own Android audio focus. Hand it to the
      // call explicitly before configuring the communication session.
      stopVoicePlayback();
      const currentGeneration = ++generation.current;
      const lease = claimAudioSession("call", `call:${input.streamId}:${currentGeneration}`);
      if (!lease) throw new Error("CALL_AUDIO_SESSION_BUSY");
      audioLease.current = lease;
      const kind = callKind(input.streamId, conversations, channels);
      const provisional: ActiveCallSession = {
        streamId: input.streamId, title: input.title, callId: null, roomName: null, kind, canEnd: false,
        status: "connecting", startedAt: Date.now(), reconnects: 0, audioRoutes: [], audioRoute: null, stats: emptyStats,
      };
      sessionRef.current = provisional;
      setSession(provisional);
      dismissIncoming();

      let credentials: CallJoinResponse | null = null;
      try {
        const preferred = preferredAudioOutputs(settings.callAudioRoute, settings.microphoneMode);
        await runAudioSessionOperation(lease, async () => {
          await AudioSession.configureAudio({ android: { preferredOutputList: [...preferred], audioTypeOptions: { manageAudioFocus: true, audioMode: "inCommunication", audioFocusMode: "gain", audioStreamType: "voiceCall", audioAttributesUsageType: "voiceCommunication", audioAttributesContentType: "speech", forceHandleAudioRouting: true } } });
          await AudioSession.startAudioSession();
          audioStarted.current = true;
        });
        if (!ownsAudioSession(lease) || !audioStarted.current) throw new Error("CALL_AUDIO_SESSION_PREEMPTED");
        const routes = availableAudioRoutes(await AudioSession.getAudioOutputs());
        const selectedRoute = preferred.find((candidate) => routes.includes(candidate)) ?? routes[0] ?? null;
        if (selectedRoute) await AudioSession.selectAudioOutput(selectedRoute);

        credentials = await api.joinCall(input.streamId, input.expectedCallId);
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
        const microphoneAllowed = canPublishSource(nextRoom, Track.Source.Microphone);
        if (microphoneAllowed) {
          await nextRoom.localParticipant.setMicrophoneEnabled(true, {
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression !== "off",
            autoGainControl: settings.autoGainControl,
          });
          if (!nextRoom.localParticipant.isMicrophoneEnabled) throw new Error("CALL_MICROPHONE_PUBLICATION_FAILED");
        } else if (kind !== "voice") {
          throw new Error("CALL_MICROPHONE_PERMISSION_RESTRICTED");
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
        recordDiagnostic("info", "call", "LiveKit call connected", {
          kind,
          connection: nextRoom.state,
          microphoneEnabled: nextRoom.localParticipant.isMicrophoneEnabled,
          audioRoute: selectedRoute ?? "unknown",
        });
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
  }, [attachRoomListeners, callsEnabled, channels, clearLocalCall, conversations, copy.active, dismissIncoming, settings, t, updateSession]);

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

  useEffect(() => {
    if (phase === "ready" || (!sessionRef.current && !roomRef.current)) return;
    void clearLocalCall({ notifyServer: true });
  }, [clearLocalCall, phase]);

  useCallStatsSampler(room, (stats) => updateSession((current) => ({ ...current, stats })));

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
  if (source === Track.Source.Unknown) return false;
  return mayPublishSource(room.localParticipant.permissions, source);
}
