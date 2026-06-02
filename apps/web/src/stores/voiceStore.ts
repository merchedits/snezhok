import { create } from "zustand";

export interface VoiceParticipant {
  socketId: string;
  conversationId?: string;
  userId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string | null;
  isSpeaking?: boolean;
}

export interface VoiceDiagnosticEvent {
  id: string;
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface VoiceDiagnostics {
  sessionId: string | null;
  conversationId: string | null;
  socketConnected: boolean;
  socketId: string | null;
  socketTransport: string;
  relaySupported: boolean;
  captureActive: boolean;
  captureContextState: string;
  playbackContextState: string;
  inputDeviceLabel: string;
  outputDeviceLabel: string;
  localSampleRate: number | null;
  relaySampleRate: number;
  localRms: number;
  localPeak: number;
  framesCaptured: number;
  framesSent: number;
  bytesSent: number;
  framesReceived: number;
  bytesReceived: number;
  framesPlayed: number;
  serverFramesReceived: number;
  serverBytesReceived: number;
  serverRecipients: number;
  serverDroppedFrames: number;
  pingMs: number | null;
  jitterBufferMs: number;
  playbackBufferedMs: number;
  lateFrames: number;
  scheduleResets: number;
  lastCaptureAt: number | null;
  lastSendAt: number | null;
  lastServerAckAt: number | null;
  lastReceiveAt: number | null;
  lastPlaybackAt: number | null;
  lastError: string | null;
  events: VoiceDiagnosticEvent[];
}

export type VoiceLatencyMode = "low" | "balanced" | "stable";
export type VoiceNoiseSuppressionMode = "browser" | "off";

const createVoiceDiagnostics = (): VoiceDiagnostics => ({
  sessionId: null,
  conversationId: null,
  socketConnected: false,
  socketId: null,
  socketTransport: "unknown",
  relaySupported: typeof window !== "undefined" && !!(window.AudioContext || (window as any).webkitAudioContext),
  captureActive: false,
  captureContextState: "idle",
  playbackContextState: "idle",
  inputDeviceLabel: "Default microphone",
  outputDeviceLabel: "Default output",
  localSampleRate: null,
  relaySampleRate: 16000,
  localRms: 0,
  localPeak: 0,
  framesCaptured: 0,
  framesSent: 0,
  bytesSent: 0,
  framesReceived: 0,
  bytesReceived: 0,
  framesPlayed: 0,
  serverFramesReceived: 0,
  serverBytesReceived: 0,
  serverRecipients: 0,
  serverDroppedFrames: 0,
  pingMs: null,
  jitterBufferMs: 140,
  playbackBufferedMs: 0,
  lateFrames: 0,
  scheduleResets: 0,
  lastCaptureAt: null,
  lastSendAt: null,
  lastServerAckAt: null,
  lastReceiveAt: null,
  lastPlaybackAt: null,
  lastError: null,
  events: [],
});

interface VoiceState {
  participants: VoiceParticipant[];
  isInCall: boolean;
  isMuted: boolean;
  isScreensharing: boolean;
  callConversationId: string | null;
  volumes: Record<string, number>;
  selectedInputDeviceId: string | null;
  selectedOutputDeviceId: string | null;
  availableDevices: MediaDeviceInfo[];
  diagnostics: VoiceDiagnostics;
  inputGain: number;
  noiseGateEnabled: boolean;
  noiseGateThreshold: number;
  latencyMode: VoiceLatencyMode;
  noiseSuppressionMode: VoiceNoiseSuppressionMode;
  setParticipants: (participants: VoiceParticipant[]) => void;
  addParticipant: (participant: VoiceParticipant) => void;
  removeParticipant: (socketId: string) => void;
  setIsInCall: (inCall: boolean) => void;
  setIsMuted: (muted: boolean) => void;
  setIsScreensharing: (isScreensharing: boolean) => void;
  setCallConversationId: (conversationId: string | null) => void;
  setSpeaking: (socketId: string, isSpeaking: boolean) => void;
  setVolume: (socketId: string, volume: number) => void;
  setInputDevice: (deviceId: string | null) => void;
  setOutputDevice: (deviceId: string | null) => void;
  setAvailableDevices: (devices: MediaDeviceInfo[]) => void;
  resetDiagnostics: (conversationId?: string | null) => void;
  updateDiagnostics: (patch: Partial<VoiceDiagnostics>) => void;
  addDiagnosticEvent: (level: VoiceDiagnosticEvent["level"], message: string) => void;
  setInputGain: (gain: number) => void;
  setNoiseGateEnabled: (enabled: boolean) => void;
  setNoiseGateThreshold: (threshold: number) => void;
  setLatencyMode: (mode: VoiceLatencyMode) => void;
  setNoiseSuppressionMode: (mode: VoiceNoiseSuppressionMode) => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  participants: [],
  isInCall: false,
  isMuted: false,
  isScreensharing: false,
  callConversationId: null,
  volumes: {},
  selectedInputDeviceId: typeof window !== "undefined" ? localStorage.getItem("selectedInputDeviceId") : null,
  selectedOutputDeviceId: typeof window !== "undefined" ? localStorage.getItem("selectedOutputDeviceId") : null,
  availableDevices: [],
  diagnostics: createVoiceDiagnostics(),
  inputGain: typeof window !== "undefined" ? Number(localStorage.getItem("voiceInputGain") || "1") : 1,
  noiseGateEnabled: typeof window !== "undefined" ? localStorage.getItem("voiceNoiseGateEnabled") === "true" : false,
  noiseGateThreshold: typeof window !== "undefined" ? Number(localStorage.getItem("voiceNoiseGateThreshold") || "0.004") : 0.004,
  latencyMode: typeof window !== "undefined" ? ((localStorage.getItem("voiceLatencyMode") as VoiceLatencyMode) || "balanced") : "balanced",
  noiseSuppressionMode: typeof window !== "undefined" ? ((localStorage.getItem("voiceNoiseSuppressionMode") as VoiceNoiseSuppressionMode) || "browser") : "browser",

  setParticipants: (participants) =>
    set((state) => {
      const saved = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("cozy_voice_user_volumes") || "{}") : {};
      const newVolumes = { ...state.volumes };
      participants.forEach((p) => {
        if (newVolumes[p.socketId] === undefined) {
          newVolumes[p.socketId] = saved[p.userId] ?? 100;
        }
      });
      return { participants, volumes: newVolumes };
    }),

  addParticipant: (participant) =>
    set((state) => {
      if (state.participants.some((p) => p.socketId === participant.socketId)) {
        return state;
      }
      const saved = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("cozy_voice_user_volumes") || "{}") : {};
      const savedVol = saved[participant.userId] ?? 100;
      return {
        participants: [...state.participants, participant],
        volumes: { ...state.volumes, [participant.socketId]: savedVol },
      };
    }),

  removeParticipant: (socketId) =>
    set((state) => {
      const nextVolumes = { ...state.volumes };
      delete nextVolumes[socketId];
      return {
        participants: state.participants.filter((p) => p.socketId !== socketId),
        volumes: nextVolumes,
      };
    }),

  setIsInCall: (isInCall) =>
    set((_state) => {
      if (!isInCall) {
        return {
          isInCall,
          participants: [],
          isMuted: false,
          isScreensharing: false,
          callConversationId: null,
          volumes: {},
          diagnostics: {
            ...createVoiceDiagnostics(),
            events: _state.diagnostics.events.slice(0, 12),
          },
        };
      }
      return { isInCall };
    }),

  setIsMuted: (isMuted) => set({ isMuted }),
  setIsScreensharing: (isScreensharing) => set({ isScreensharing }),
  setCallConversationId: (callConversationId) => set({ callConversationId }),

  setSpeaking: (socketIdOrUserId, isSpeaking) =>
    set((state) => ({
      participants: state.participants.map((p) =>
        (p.socketId === socketIdOrUserId || p.userId === socketIdOrUserId) ? { ...p, isSpeaking } : p
      ),
    })),

  setVolume: (socketId, volume) =>
    set((state) => ({
      volumes: { ...state.volumes, [socketId]: volume },
    })),

  setInputDevice: (selectedInputDeviceId) => {
    if (selectedInputDeviceId) {
      localStorage.setItem("selectedInputDeviceId", selectedInputDeviceId);
    } else {
      localStorage.removeItem("selectedInputDeviceId");
    }
    set({ selectedInputDeviceId });
  },
  setOutputDevice: (selectedOutputDeviceId) => {
    if (selectedOutputDeviceId) {
      localStorage.setItem("selectedOutputDeviceId", selectedOutputDeviceId);
    } else {
      localStorage.removeItem("selectedOutputDeviceId");
    }
    set({ selectedOutputDeviceId });
  },
  setAvailableDevices: (availableDevices) => set({ availableDevices }),

  resetDiagnostics: (conversationId = null) =>
    set({
      diagnostics: {
        ...createVoiceDiagnostics(),
        sessionId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        conversationId,
      },
    }),

  updateDiagnostics: (patch) =>
    set((state) => ({
      diagnostics: { ...state.diagnostics, ...patch },
    })),

  addDiagnosticEvent: (level, message) =>
    set((state) => ({
      diagnostics: {
        ...state.diagnostics,
        lastError: level === "error" ? message : state.diagnostics.lastError,
        events: [
          { id: `${Date.now()}-${Math.random()}`, at: Date.now(), level, message },
          ...state.diagnostics.events,
        ].slice(0, 20),
      },
    })),

  setInputGain: (inputGain) => {
    const nextGain = Math.max(0.25, Math.min(4, inputGain));
    localStorage.setItem("voiceInputGain", String(nextGain));
    set({ inputGain: nextGain });
  },

  setNoiseGateEnabled: (noiseGateEnabled) => {
    localStorage.setItem("voiceNoiseGateEnabled", String(noiseGateEnabled));
    set({ noiseGateEnabled });
  },

  setNoiseGateThreshold: (noiseGateThreshold) => {
    const nextThreshold = Math.max(0.0005, Math.min(0.08, noiseGateThreshold));
    localStorage.setItem("voiceNoiseGateThreshold", String(nextThreshold));
    set({ noiseGateThreshold: nextThreshold });
  },

  setLatencyMode: (latencyMode) => {
    localStorage.setItem("voiceLatencyMode", latencyMode);
    set({ latencyMode });
  },

  setNoiseSuppressionMode: (noiseSuppressionMode) => {
    localStorage.setItem("voiceNoiseSuppressionMode", noiseSuppressionMode);
    set({ noiseSuppressionMode });
  },
}));
