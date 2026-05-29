import { create } from "zustand";

export interface VoiceParticipant {
  socketId: string;
  userId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string | null;
  isSpeaking?: boolean;
}

interface VoiceState {
  participants: VoiceParticipant[];
  isInCall: boolean;
  isMuted: boolean;
  isScreensharing: boolean;
  volumes: Record<string, number>;
  selectedInputDeviceId: string | null;
  selectedOutputDeviceId: string | null;
  availableDevices: MediaDeviceInfo[];
  setParticipants: (participants: VoiceParticipant[]) => void;
  addParticipant: (participant: VoiceParticipant) => void;
  removeParticipant: (socketId: string) => void;
  setIsInCall: (inCall: boolean) => void;
  setIsMuted: (muted: boolean) => void;
  setIsScreensharing: (isScreensharing: boolean) => void;
  setSpeaking: (socketId: string, isSpeaking: boolean) => void;
  setVolume: (socketId: string, volume: number) => void;
  setInputDevice: (deviceId: string | null) => void;
  setOutputDevice: (deviceId: string | null) => void;
  setAvailableDevices: (devices: MediaDeviceInfo[]) => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  participants: [],
  isInCall: false,
  isMuted: false,
  isScreensharing: false,
  volumes: {},
  selectedInputDeviceId: typeof window !== "undefined" ? localStorage.getItem("selectedInputDeviceId") : null,
  selectedOutputDeviceId: typeof window !== "undefined" ? localStorage.getItem("selectedOutputDeviceId") : null,
  availableDevices: [],

  setParticipants: (participants) => set({ participants }),

  addParticipant: (participant) =>
    set((state) => {
      if (state.participants.some((p) => p.socketId === participant.socketId)) {
        return state;
      }
      return { participants: [...state.participants, participant] };
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
        return { isInCall, participants: [], isMuted: false, isScreensharing: false, volumes: {} };
      }
      return { isInCall };
    }),

  setIsMuted: (isMuted) => set({ isMuted }),
  setIsScreensharing: (isScreensharing) => set({ isScreensharing }),

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
}));
