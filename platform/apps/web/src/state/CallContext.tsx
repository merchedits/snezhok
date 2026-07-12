import { createContext, useCallback, useContext, useMemo, useRef, useState, type PropsWithChildren } from "react";
import type { Participant, Room } from "livekit-client";
import type { Id } from "@snezhok/contracts";
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
  leave: () => void;
  toggleMute: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  setSurfaceOpen: (open: boolean) => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: PropsWithChildren) {
  const app = useApp();
  const [room, setRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
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

  const leave = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current?.removeAllListeners();
    roomRef.current = null;
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

  const join = useCallback(async (nextRoomId: Id, nextTitle: string, options: { video?: boolean } = {}) => {
    if (roomRef.current && roomId === nextRoomId) {
      setSurfaceOpen(true);
      return;
    }
    if (roomRef.current) leave();
    setStatus("connecting");
    setError(null);
    setRoomId(nextRoomId);
    setTitle(nextTitle);
    setSurfaceOpen(true);

    const { ConnectionState, Room: LiveKitRoom, RoomEvent } = await import("livekit-client");
    const nextRoom = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
    const refresh = () => updateParticipants(nextRoom);
    nextRoom.on(RoomEvent.ParticipantConnected, refresh);
    nextRoom.on(RoomEvent.ParticipantDisconnected, refresh);
    nextRoom.on(RoomEvent.TrackSubscribed, refresh);
    nextRoom.on(RoomEvent.TrackUnsubscribed, refresh);
    nextRoom.on(RoomEvent.ActiveSpeakersChanged, (speakers) => setActiveSpeakerIds(new Set(speakers.map((speaker) => speaker.identity))));
    nextRoom.on(RoomEvent.ConnectionStateChanged, (connection) => {
      if (connection === ConnectionState.Reconnecting) setStatus("reconnecting");
      if (connection === ConnectionState.Connected) setStatus("connected");
      if (connection === ConnectionState.Disconnected && roomRef.current === nextRoom) setStatus("failed");
    });

    try {
      const credentials = await api.callToken(nextRoomId, { video: options.video || false });
      await nextRoom.connect(credentials.url, credentials.token, { autoSubscribe: true });
      roomRef.current = nextRoom;
      setRoom(nextRoom);
      const voice = app.bootstrap?.settings;
      await nextRoom.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: voice?.echoCancellation ?? true,
        noiseSuppression: voice?.noiseSuppression !== "off",
        autoGainControl: voice?.autoGainControl ?? true,
      });
      if (options.video) {
        await nextRoom.localParticipant.setCameraEnabled(true);
        setCameraEnabled(true);
      }
      updateParticipants(nextRoom);
      setStatus("connected");
    } catch (cause) {
      nextRoom.disconnect();
      setStatus("failed");
      setError(cause instanceof Error ? cause.message : "Call connection failed.");
    }
  }, [app.bootstrap?.settings.autoGainControl, app.bootstrap?.settings.echoCancellation, app.bootstrap?.settings.noiseSuppression, leave, roomId, updateParticipants]);

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

  const toggleScreenShare = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom) return;
    const next = !screenSharing;
    await activeRoom.localParticipant.setScreenShareEnabled(next, { audio: true });
    setScreenSharing(next);
    updateParticipants(activeRoom);
  }, [screenSharing, updateParticipants]);

  const value = useMemo<CallContextValue>(() => ({
    room,
    roomId,
    title,
    status,
    error,
    participants,
    activeSpeakerIds,
    muted,
    cameraEnabled,
    screenSharing,
    surfaceOpen,
    join,
    leave,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    setSurfaceOpen,
  }), [activeSpeakerIds, cameraEnabled, error, join, leave, muted, participants, room, roomId, screenSharing, status, surfaceOpen, title, toggleCamera, toggleMute, toggleScreenShare]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const context = useContext(CallContext);
  if (!context) throw new Error("useCall must be used inside CallProvider");
  return context;
}
