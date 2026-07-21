import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import type { Participant, Room } from "livekit-client";
import type { CallUpdatePayload, Id } from "@snezhok/contracts";
import { api } from "../lib/api.js";
import { useApp } from "./AppContext.js";

export type CallStatus = "idle" | "connecting" | "connected" | "reconnecting" | "failed";

interface CallContextValue {
  room: Room | null;
  roomId: Id | null;
  title: string;
  status: CallStatus;
  error: string | null;
  participants: Participant[];
  activeSpeakerIds: Set<string>;
  muted: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  surfaceOpen: boolean;
  join: (roomId: Id, title: string, options?: { video?: boolean }) => Promise<void>;
  leave: (options?: { endForEveryone?: boolean }) => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: (options?: ScreenShareQuality) => Promise<void>;
  setSurfaceOpen: (open: boolean) => void;
}

export interface ScreenShareQuality {
  width: number;
  height: number;
  frameRate: number;
  contentHint: "motion" | "text";
}

interface BeforeLogoutDetail {
  waitUntil(promise: Promise<unknown>): void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: PropsWithChildren) {
  const app = useApp();
  const [room, setRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const callIdRef = useRef<Id | null>(null);
  const remotelyEndedCalls = useRef(new Set<Id>());
  const generation = useRef(0);
  const joinOperation = useRef<{ roomId: Id; promise: Promise<void> } | null>(null);
  const [roomId, setRoomId] = useState<Id | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeSpeakerIds, setActiveSpeakerIds] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [surfaceOpen, setSurfaceOpen] = useState(false);

  const updateParticipants = useCallback((nextRoom: Room) => {
    setParticipants([nextRoom.localParticipant, ...Array.from(nextRoom.remoteParticipants.values())]);
  }, []);

  const resetState = useCallback(() => {
    setRoom(null);
    setRoomId(null);
    setTitle("");
    setStatus("idle");
    setError(null);
    setParticipants([]);
    setActiveSpeakerIds(new Set());
    setMuted(false);
    setCameraEnabled(false);
    setScreenSharing(false);
    setSurfaceOpen(false);
  }, []);

  const clearCall = useCallback(async (options: { endForEveryone?: boolean; notifyServer?: boolean } = {}) => {
    generation.current += 1;
    const activeRoom = roomRef.current;
    const activeCallId = callIdRef.current;
    const pendingJoin = joinOperation.current?.promise;
    roomRef.current = null;
    callIdRef.current = null;
    joinOperation.current = null;
    activeRoom?.removeAllListeners();
    // State is cleared before the first await so camera, microphone and screen
    // share UI can never survive logout or a rapid second join.
    resetState();
    await Promise.resolve(activeRoom?.disconnect()).catch(() => undefined);
    await pendingJoin?.catch(() => undefined);
    if (activeCallId && options.notifyServer !== false) {
      const notify = options.endForEveryone ? api.endCall(activeCallId) : api.leaveCall(activeCallId);
      await notify.catch(() => undefined);
    }
  }, [resetState]);

  const leave = useCallback((options: { endForEveryone?: boolean } = {}) => clearCall(options), [clearCall]);

  const join = useCallback(async (nextRoomId: Id, nextTitle: string, options: { video?: boolean } = {}) => {
    if (roomRef.current && roomId === nextRoomId) {
      setSurfaceOpen(true);
      return;
    }
    if (joinOperation.current?.roomId === nextRoomId) {
      setSurfaceOpen(true);
      return joinOperation.current.promise;
    }
    if (roomRef.current || joinOperation.current) await leave();

    const currentGeneration = ++generation.current;
    setStatus("connecting");
    setError(null);
    setRoomId(nextRoomId);
    setTitle(nextTitle);
    setSurfaceOpen(true);

    const operation = (async () => {
      let nextRoom: Room | null = null;
      let issuedCallId: Id | null = null;
      try {
        const { ConnectionState, Room: LiveKitRoom, RoomEvent } = await import("livekit-client");
        if (generation.current !== currentGeneration) return;
        nextRoom = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
        const active = () => generation.current === currentGeneration && roomRef.current === nextRoom;
        const refresh = () => { if (active()) updateParticipants(nextRoom!); };
        nextRoom.on(RoomEvent.ParticipantConnected, refresh);
        nextRoom.on(RoomEvent.ParticipantDisconnected, refresh);
        nextRoom.on(RoomEvent.TrackSubscribed, refresh);
        nextRoom.on(RoomEvent.TrackUnsubscribed, refresh);
        nextRoom.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          if (active()) setActiveSpeakerIds(new Set(speakers.map((speaker) => speaker.identity)));
        });
        nextRoom.on(RoomEvent.ConnectionStateChanged, (connection) => {
          if (!active()) return;
          if (connection === ConnectionState.Reconnecting) setStatus("reconnecting");
          if (connection === ConnectionState.Connected) setStatus("connected");
          if (connection === ConnectionState.Disconnected) void leave();
        });

        const credentials = await api.callToken(nextRoomId, { video: options.video || false });
        issuedCallId = credentials.callId;
        if (remotelyEndedCalls.current.delete(credentials.callId)) {
          generation.current += 1;
          resetState();
          await api.leaveCall(credentials.callId).catch(() => undefined);
          return;
        }
        if (generation.current !== currentGeneration) {
          await api.leaveCall(credentials.callId).catch(() => undefined);
          return;
        }
        callIdRef.current = credentials.callId;
        roomRef.current = nextRoom;
        setRoom(nextRoom);
        await nextRoom.connect(credentials.url, credentials.token, { autoSubscribe: true });
        if (!active()) {
          await Promise.resolve(nextRoom.disconnect()).catch(() => undefined);
          return;
        }
        const voice = app.bootstrap?.settings;
        await nextRoom.localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: voice?.echoCancellation ?? true,
          noiseSuppression: voice?.noiseSuppression !== "off",
          autoGainControl: voice?.autoGainControl ?? true,
        });
        if (!active()) return;
        if (options.video) {
          await nextRoom.localParticipant.setCameraEnabled(true);
          if (active()) setCameraEnabled(true);
        }
        updateParticipants(nextRoom);
        setStatus("connected");
      } catch (cause) {
        nextRoom?.removeAllListeners();
        await Promise.resolve(nextRoom?.disconnect()).catch(() => undefined);
        if (generation.current !== currentGeneration) return;
        if (issuedCallId) await api.leaveCall(issuedCallId).catch(() => undefined);
        roomRef.current = null;
        callIdRef.current = null;
        setRoom(null);
        setParticipants([]);
        setStatus("failed");
        setError(cause instanceof Error ? cause.message : "Call connection failed.");
      }
    })().finally(() => {
      if (joinOperation.current?.promise === operation) joinOperation.current = null;
    });
    joinOperation.current = { roomId: nextRoomId, promise: operation };
    return operation;
  }, [app.bootstrap?.settings, leave, resetState, roomId, updateParticipants]);

  useEffect(() => {
    if (app.status !== "ready" && (roomRef.current || joinOperation.current)) void leave();
  }, [app.status, leave]);

  useEffect(() => {
    const beforeLogout = (event: Event) => {
      const detail = (event as CustomEvent<BeforeLogoutDetail>).detail;
      detail?.waitUntil(leave());
    };
    const callUpdated = (event: Event) => {
      const payload = (event as CustomEvent<CallUpdatePayload>).detail;
      if (payload?.state !== "ended") return;
      if (payload.roomId === callIdRef.current) {
        void clearCall({ notifyServer: false });
        return;
      }
      remotelyEndedCalls.current.add(payload.roomId);
      if (remotelyEndedCalls.current.size > 32) remotelyEndedCalls.current.delete(remotelyEndedCalls.current.values().next().value!);
    };
    window.addEventListener("snezhok:before-logout", beforeLogout);
    window.addEventListener("snezhok:call-updated", callUpdated);
    return () => {
      window.removeEventListener("snezhok:before-logout", beforeLogout);
      window.removeEventListener("snezhok:call-updated", callUpdated);
    };
  }, [clearCall, leave]);

  useEffect(() => () => { void leave(); }, [leave]);

  const toggleMute = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom) return;
    const next = !muted;
    await activeRoom.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom) return;
    const next = !cameraEnabled;
    await activeRoom.localParticipant.setCameraEnabled(next);
    setCameraEnabled(next);
    updateParticipants(activeRoom);
  }, [cameraEnabled, updateParticipants]);

  const toggleScreenShare = useCallback(async (options?: ScreenShareQuality) => {
    const activeRoom = roomRef.current;
    if (!activeRoom) return;
    const next = !screenSharing;
    await activeRoom.localParticipant.setScreenShareEnabled(next, next ? {
      audio: true,
      ...(options ? { resolution: { width: options.width, height: options.height, frameRate: options.frameRate }, contentHint: options.contentHint } : {}),
    } : undefined);
    setScreenSharing(next);
    updateParticipants(activeRoom);
  }, [screenSharing, updateParticipants]);

  const value = useMemo<CallContextValue>(() => ({
    room, roomId, title, status, error, participants, activeSpeakerIds, muted,
    cameraEnabled, screenSharing, surfaceOpen, join, leave, toggleMute,
    toggleCamera, toggleScreenShare, setSurfaceOpen,
  }), [activeSpeakerIds, cameraEnabled, error, join, leave, muted, participants, room, roomId, screenSharing, status, surfaceOpen, title, toggleCamera, toggleMute, toggleScreenShare]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const context = useContext(CallContext);
  if (!context) throw new Error("useCall must be used inside CallProvider");
  return context;
}
