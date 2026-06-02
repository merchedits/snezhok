import { useEffect } from "react";
import Peer from "simple-peer";
import { getSocket } from "../lib/socket.js";
import { useVoiceStore, VoiceParticipant, type VoiceDiagnostics } from "../stores/voiceStore.js";
import { useAuthStore } from "../stores/authStore.js";
import { useMessageStore } from "../stores/messageStore.js";
import { playJoinSound, playLeaveSound, playMuteSound, playUnmuteSound, playScreenshareSound } from "../lib/sounds.js";

// Module-level singletons to ensure voice state is shared across all components calling useVoice()
let localStreamSingleton: MediaStream | null = null;
let localScreenStreamSingleton: MediaStream | null = null;
const peersSingleton = new Map<string, Peer.Instance>(); // socketId -> Peer instance
const audioElementsSingleton = new Map<string, HTMLAudioElement>(); // socketId -> Audio element
const audioContextsSingleton = new Map<string, { audioContext: AudioContext; analyser: AnalyserNode; cancelFrame: number }>(); // socketId -> Audio analysis nodes
const gainNodesSingleton = new Map<string, GainNode>(); // socketId -> GainNode
const relayGainNodesSingleton = new Map<string, GainNode>(); // socketId -> relayed audio gain
const relayAudioSourcesSingleton = new Map<string, Set<AudioBufferSourceNode>>(); // socketId -> scheduled relayed audio
const relayPlaybackPositionsSingleton = new Map<string, number>(); // socketId -> next scheduled playback time
const relaySpeakingTimersSingleton = new Map<string, number>(); // socketId -> timeout id
const webRtcConnectedPeersSingleton = new Set<string>(); // socketIds with connected WebRTC peers
const webRtcAudioPeersSingleton = new Set<string>(); // socketIds with an active WebRTC audio stream
let peerConfigSingleton: RTCConfiguration | null = null;
let sharedAudioContext: AudioContext | null = null;
let relayCaptureContextSingleton: AudioContext | null = null;
let relayCaptureProcessorSingleton: ScriptProcessorNode | null = null;
let relayCaptureSourceSingleton: MediaStreamAudioSourceNode | null = null;
let relayCaptureMutedGainSingleton: GainNode | null = null;
let relaySequenceSingleton = 0;
let lastCaptureDiagnosticsUpdateAt = 0;
const RELAY_SAMPLE_RATE = 16000;
const RELAY_BUFFER_SIZE = 2048;

function getJitterBufferSeconds() {
  const mode = useVoiceStore.getState().latencyMode;
  if (mode === "low") return 0.08;
  if (mode === "stable") return 0.24;
  return 0.14;
}

function updateDiagnostics(patch: Partial<VoiceDiagnostics>) {
  useVoiceStore.getState().updateDiagnostics(patch);
}

function addDiagnosticEvent(level: "info" | "warn" | "error", message: string) {
  console[level === "error" ? "error" : level === "warn" ? "warn" : "info"](`[voice] ${message}`);
  useVoiceStore.getState().addDiagnosticEvent(level, message);
}

function getAudioDeviceLabel(deviceId: string | null, kind: MediaDeviceKind, fallback: string) {
  const devices = useVoiceStore.getState().availableDevices;
  const device = deviceId ? devices.find((d) => d.deviceId === deviceId && d.kind === kind) : null;
  return device?.label || fallback;
}

function getFrameLevel(input: Float32Array) {
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < input.length; i++) {
    const value = Math.abs(input[i]);
    sumSquares += value * value;
    if (value > peak) peak = value;
  }
  return {
    rms: Math.sqrt(sumSquares / input.length),
    peak,
  };
}

function processInputFrame(input: Float32Array, level: { rms: number; peak: number }) {
  const { inputGain, noiseGateEnabled, noiseGateThreshold } = useVoiceStore.getState();
  const gateGain = noiseGateEnabled && level.rms < noiseGateThreshold
    ? Math.max(0, Math.min(1, level.rms / noiseGateThreshold)) * 0.35
    : 1;

  const processed = new Float32Array(input.length);
  const gain = inputGain * gateGain;
  for (let i = 0; i < input.length; i++) {
    processed[i] = Math.max(-1, Math.min(1, input[i] * gain));
  }

  return processed;
}

function emitRelayFrame(conversationId: string, chunk: ArrayBuffer, source: "mic" | "tone") {
  const socket = getSocket();
  if (source === "mic" && !shouldSendRelayMic()) {
    const state = useVoiceStore.getState().diagnostics;
    updateDiagnostics({
      relayMode: "standby",
      webRtcConnectedPeers: webRtcConnectedPeersSingleton.size,
      webRtcAudioPeers: webRtcAudioPeersSingleton.size,
      framesCaptured: state.framesCaptured,
    });
    return;
  }

  socket.emit("voice:audio-frame", {
    conversationId,
    sampleRate: RELAY_SAMPLE_RATE,
    channels: 1,
    sequence: relaySequenceSingleton++,
    sentAt: Date.now(),
    source,
    chunk,
  });

  const state = useVoiceStore.getState().diagnostics;
  useVoiceStore.getState().updateDiagnostics({
    socketConnected: socket.connected,
    socketId: socket.id || null,
    socketTransport: (socket.io.engine as any)?.transport?.name || "unknown",
    framesSent: state.framesSent + 1,
    bytesSent: state.bytesSent + chunk.byteLength,
    lastSendAt: Date.now(),
    relayMode: "active",
    webRtcConnectedPeers: webRtcConnectedPeersSingleton.size,
    webRtcAudioPeers: webRtcAudioPeersSingleton.size,
  });
}

function shouldSendRelayMic() {
  const socket = getSocket();
  const remoteParticipants = useVoiceStore
    .getState()
    .participants
    .filter((participant) => participant.socketId !== socket.id);

  if (remoteParticipants.length === 0) return false;
  return remoteParticipants.some((participant) => !webRtcAudioPeersSingleton.has(participant.socketId));
}

function markWebRtcConnected(socketId: string) {
  webRtcConnectedPeersSingleton.add(socketId);
  updateDiagnostics({
    webRtcConnectedPeers: webRtcConnectedPeersSingleton.size,
    webRtcAudioPeers: webRtcAudioPeersSingleton.size,
    relayMode: shouldSendRelayMic() ? "active" : "standby",
  });
}

function markWebRtcAudioActive(socketId: string) {
  webRtcAudioPeersSingleton.add(socketId);
  closeRelayAudio(socketId);
  updateDiagnostics({
    webRtcConnectedPeers: webRtcConnectedPeersSingleton.size,
    webRtcAudioPeers: webRtcAudioPeersSingleton.size,
    relayMode: shouldSendRelayMic() ? "active" : "standby",
  });
  addDiagnosticEvent("info", `WebRTC audio active for ${socketId}; relay moved to fallback standby.`);
}

async function getPeerConfig() {
  if (peerConfigSingleton) return peerConfigSingleton;

  try {
    const res = await fetch("/api/rtc-config");
    if (res.ok) {
      const data = await res.json();
      peerConfigSingleton = {
        iceServers: Array.isArray(data.iceServers) ? data.iceServers : [],
        iceCandidatePoolSize: 4,
      };
      return peerConfigSingleton;
    }
  } catch (err) {
    console.warn("Could not load RTC config:", err);
  }

  peerConfigSingleton = { iceServers: [], iceCandidatePoolSize: 4 };
  return peerConfigSingleton;
}

function attachPeerDiagnostics(peer: Peer.Instance, socketId: string, label: string) {
  const warnTimer = window.setTimeout(() => {
    if (!peer.connected && !peer.destroyed) {
      console.warn(
        `[voice] Peer ${label} (${socketId}) has not connected after 12s. This usually means STUN/TURN/NAT traversal failed.`
      );
    }
  }, 12000);

  peer.on("connect", () => {
    window.clearTimeout(warnTimer);
    markWebRtcConnected(socketId);
    console.info(`[voice] Peer ${label} (${socketId}) connected.`);
  });

  peer.on("iceStateChange", (iceConnectionState, iceGatheringState) => {
    console.info(`[voice] ICE ${label} (${socketId}):`, {
      iceConnectionState,
      iceGatheringState,
    });
  });

  peer.on("close", () => {
    window.clearTimeout(warnTimer);
  });
}

async function getSharedAudioContext() {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextClass();
  }
  if (sharedAudioContext.state === "suspended") {
    await sharedAudioContext.resume().catch(console.error);
  }
  updateDiagnostics({ playbackContextState: sharedAudioContext.state });
  return sharedAudioContext;
}

function floatTo16BitPcm(input: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / sampleRateRatio));
  const output = new Int16Array(outputLength);

  let inputOffset = 0;
  for (let outputOffset = 0; outputOffset < outputLength; outputOffset++) {
    const nextInputOffset = Math.min(input.length, Math.round((outputOffset + 1) * sampleRateRatio));
    let accum = 0;
    let count = 0;

    for (let i = inputOffset; i < nextInputOffset; i++) {
      accum += input[i];
      count++;
    }

    const sample = Math.max(-1, Math.min(1, count > 0 ? accum / count : 0));
    output[outputOffset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    inputOffset = nextInputOffset;
  }

  return output.buffer;
}

async function startRelayCapture(stream: MediaStream, conversationId: string) {
  stopRelayCapture();

  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    addDiagnosticEvent("error", "Web Audio is unavailable in this browser; relayed audio cannot capture/play.");
    updateDiagnostics({ relaySupported: false, captureActive: false, captureContextState: "unsupported" });
    return;
  }

  relayCaptureContextSingleton = new AudioContextClass();
  if (relayCaptureContextSingleton.state === "suspended") {
    await relayCaptureContextSingleton.resume().catch(console.error);
  }

  relayCaptureSourceSingleton = relayCaptureContextSingleton.createMediaStreamSource(stream);
  relayCaptureProcessorSingleton = relayCaptureContextSingleton.createScriptProcessor(RELAY_BUFFER_SIZE, 1, 1);
  relayCaptureMutedGainSingleton = relayCaptureContextSingleton.createGain();
  relayCaptureMutedGainSingleton.gain.value = 0;

  updateDiagnostics({
    relaySupported: true,
    captureActive: true,
    captureContextState: relayCaptureContextSingleton.state,
    inputDeviceLabel: getAudioDeviceLabel(useVoiceStore.getState().selectedInputDeviceId, "audioinput", "Default microphone"),
    outputDeviceLabel: getAudioDeviceLabel(useVoiceStore.getState().selectedOutputDeviceId, "audiooutput", "Default output"),
    localSampleRate: relayCaptureContextSingleton.sampleRate,
    relaySampleRate: RELAY_SAMPLE_RATE,
  });
  addDiagnosticEvent("info", `Started audio capture at ${relayCaptureContextSingleton.sampleRate} Hz, relaying at ${RELAY_SAMPLE_RATE} Hz.`);

  relayCaptureProcessorSingleton.onaudioprocess = (event) => {
    if (useVoiceStore.getState().isMuted) return;
    const input = event.inputBuffer.getChannelData(0);
    const level = getFrameLevel(input);
    const processedInput = processInputFrame(input, level);
    const chunk = floatTo16BitPcm(processedInput, relayCaptureContextSingleton!.sampleRate, RELAY_SAMPLE_RATE);
    emitRelayFrame(conversationId, chunk, "mic");

    const now = Date.now();
    const current = useVoiceStore.getState().diagnostics;
    if (now - lastCaptureDiagnosticsUpdateAt > 180) {
      lastCaptureDiagnosticsUpdateAt = now;
      updateDiagnostics({
        captureContextState: relayCaptureContextSingleton?.state || "closed",
        localRms: level.rms,
        localPeak: level.peak,
        jitterBufferMs: Math.round(getJitterBufferSeconds() * 1000),
        framesCaptured: current.framesCaptured + 1,
        lastCaptureAt: now,
      });
    } else {
      updateDiagnostics({
        framesCaptured: current.framesCaptured + 1,
        lastCaptureAt: now,
      });
    }
  };

  relayCaptureSourceSingleton.connect(relayCaptureProcessorSingleton);
  relayCaptureProcessorSingleton.connect(relayCaptureMutedGainSingleton);
  relayCaptureMutedGainSingleton.connect(relayCaptureContextSingleton.destination);
}

function stopRelayCapture() {
  if (relayCaptureProcessorSingleton) {
    relayCaptureProcessorSingleton.onaudioprocess = null;
    try {
      relayCaptureProcessorSingleton.disconnect();
    } catch (e) {}
    relayCaptureProcessorSingleton = null;
  }

  if (relayCaptureSourceSingleton) {
    try {
      relayCaptureSourceSingleton.disconnect();
    } catch (e) {}
    relayCaptureSourceSingleton = null;
  }

  if (relayCaptureMutedGainSingleton) {
    try {
      relayCaptureMutedGainSingleton.disconnect();
    } catch (e) {}
    relayCaptureMutedGainSingleton = null;
  }

  if (relayCaptureContextSingleton) {
    try {
      relayCaptureContextSingleton.close();
    } catch (e) {}
    relayCaptureContextSingleton = null;
  }

  updateDiagnostics({ captureActive: false, captureContextState: "closed" });
}

function getRelayGainNode(socketId: string, context: AudioContext) {
  const existing = relayGainNodesSingleton.get(socketId);
  if (existing && existing.context === context) return existing;

  const gainNode = context.createGain();
  const participant = useVoiceStore.getState().participants.find((p) => p.socketId === socketId);
  const saved = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("cozy_voice_user_volumes") || "{}") : {};
  const volume = participant?.userId ? (saved[participant.userId] ?? 100) : 100;
  gainNode.gain.value = volume / 100;
  gainNode.connect(context.destination);
  relayGainNodesSingleton.set(socketId, gainNode);
  return gainNode;
}

function toArrayBuffer(chunk: ArrayBuffer | Uint8Array) {
  if (chunk instanceof ArrayBuffer) return chunk;
  return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
}

async function playRelayAudioFrame(socketId: string, chunk: ArrayBuffer | Uint8Array, sampleRate: number) {
  const context = await getSharedAudioContext();
  if (!context) {
    addDiagnosticEvent("error", "Cannot play incoming audio because Web Audio is unavailable.");
    return;
  }

  if (typeof (context as any).setSinkId === "function") {
    const outputId = useVoiceStore.getState().selectedOutputDeviceId;
    if (outputId) {
      (context as any).setSinkId(outputId).catch(console.error);
    }
  }

  const pcm = new Int16Array(toArrayBuffer(chunk));
  if (pcm.length === 0) return;

  const before = useVoiceStore.getState().diagnostics;
  updateDiagnostics({
    framesReceived: before.framesReceived + 1,
    bytesReceived: before.bytesReceived + pcm.byteLength,
    lastReceiveAt: Date.now(),
  });

  const audioBuffer = context.createBuffer(1, pcm.length, sampleRate || RELAY_SAMPLE_RATE);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) {
    channel[i] = Math.max(-1, Math.min(1, pcm[i] / 32768));
  }

  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(getRelayGainNode(socketId, context));

  const jitterBufferSeconds = getJitterBufferSeconds();
  let nextTime = relayPlaybackPositionsSingleton.get(socketId) ?? context.currentTime + jitterBufferSeconds;
  const currentBufferedSeconds = Math.max(0, nextTime - context.currentTime);
  const currentDiagnostics = useVoiceStore.getState().diagnostics;

  if (nextTime < context.currentTime + 0.015) {
    nextTime = context.currentTime + jitterBufferSeconds;
    updateDiagnostics({
      lateFrames: currentDiagnostics.lateFrames + 1,
      scheduleResets: currentDiagnostics.scheduleResets + 1,
    });
  } else if (currentBufferedSeconds > 1.2) {
    nextTime = context.currentTime + jitterBufferSeconds;
    updateDiagnostics({
      scheduleResets: currentDiagnostics.scheduleResets + 1,
    });
  }

  source.start(nextTime);
  relayPlaybackPositionsSingleton.set(socketId, nextTime + audioBuffer.duration);
  const current = useVoiceStore.getState().diagnostics;
  updateDiagnostics({
    playbackContextState: context.state,
    jitterBufferMs: Math.round(jitterBufferSeconds * 1000),
    playbackBufferedMs: Math.round(Math.max(0, nextTime - context.currentTime) * 1000),
    framesPlayed: current.framesPlayed + 1,
    lastPlaybackAt: Date.now(),
  });

  const sources = relayAudioSourcesSingleton.get(socketId) || new Set<AudioBufferSourceNode>();
  sources.add(source);
  relayAudioSourcesSingleton.set(socketId, sources);
  source.onended = () => sources.delete(source);

  useVoiceStore.getState().setSpeaking(socketId, true);
  const previousTimer = relaySpeakingTimersSingleton.get(socketId);
  if (previousTimer) window.clearTimeout(previousTimer);
  relaySpeakingTimersSingleton.set(socketId, window.setTimeout(() => {
    useVoiceStore.getState().setSpeaking(socketId, false);
    relaySpeakingTimersSingleton.delete(socketId);
  }, 350));
}

function closeRelayAudio(socketId?: string) {
  const ids = socketId ? [socketId] : Array.from(new Set([
    ...relayAudioSourcesSingleton.keys(),
    ...relayGainNodesSingleton.keys(),
    ...relaySpeakingTimersSingleton.keys(),
  ]));

  ids.forEach((id) => {
    relayAudioSourcesSingleton.get(id)?.forEach((source) => {
      try {
        source.stop();
      } catch (e) {}
      try {
        source.disconnect();
      } catch (e) {}
    });
    relayAudioSourcesSingleton.delete(id);

    const gainNode = relayGainNodesSingleton.get(id);
    if (gainNode) {
      try {
        gainNode.disconnect();
      } catch (e) {}
      relayGainNodesSingleton.delete(id);
    }

    const timer = relaySpeakingTimersSingleton.get(id);
    if (timer) window.clearTimeout(timer);
    relaySpeakingTimersSingleton.delete(id);
    relayPlaybackPositionsSingleton.delete(id);
    useVoiceStore.getState().setSpeaking(id, false);
  });
}

function createTonePcmFrame(frequency: number, durationMs: number, frameIndex: number) {
  const sampleCount = Math.floor((RELAY_SAMPLE_RATE * durationMs) / 1000);
  const pcm = new Int16Array(sampleCount);
  const startSample = frameIndex * sampleCount;

  for (let i = 0; i < sampleCount; i++) {
    const t = (startSample + i) / RELAY_SAMPLE_RATE;
    const envelope = Math.min(1, i / 120) * Math.min(1, (sampleCount - i) / 120);
    pcm[i] = Math.sin(2 * Math.PI * frequency * t) * 0x4fff * envelope;
  }

  return pcm.buffer;
}

export function useVoice() {
  const { 
    isInCall, isMuted, isScreensharing, setIsInCall, setIsMuted, setIsScreensharing, setSpeaking,
    setCallConversationId, selectedInputDeviceId, selectedOutputDeviceId, volumes, setAvailableDevices
  } = useVoiceStore();
  const { user: currentUser } = useAuthStore();

  // Handle joining a voice call
  const joinCall = async () => {
    if (useVoiceStore.getState().isInCall) {
      return;
    }
    try {
      // Initialize/resume shared AudioContext directly inside user click gesture context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        if (!sharedAudioContext) {
          sharedAudioContext = new AudioContextClass();
        }
        if (sharedAudioContext.state === "suspended") {
          await sharedAudioContext.resume().catch(console.error);
        }
      }

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: useVoiceStore.getState().noiseSuppressionMode === "browser",
        autoGainControl: useVoiceStore.getState().noiseSuppressionMode === "browser",
      };

      if (selectedInputDeviceId) {
        audioConstraints.deviceId = { exact: selectedInputDeviceId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
      localStreamSingleton = stream;

      // Handle initial mute state
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });

      const socket = getSocket();
      const conversationId = useMessageStore.getState().activeConversationId || "global";
      webRtcConnectedPeersSingleton.clear();
      webRtcAudioPeersSingleton.clear();
      useVoiceStore.getState().resetDiagnostics(conversationId);
      updateDiagnostics({
        socketConnected: socket.connected,
        socketId: socket.id || null,
        socketTransport: (socket.io.engine as any)?.transport?.name || "unknown",
        conversationId,
        webRtcConnectedPeers: 0,
        webRtcAudioPeers: 0,
        relayMode: "active",
        inputDeviceLabel: getAudioDeviceLabel(selectedInputDeviceId, "audioinput", "Default microphone"),
        outputDeviceLabel: getAudioDeviceLabel(selectedOutputDeviceId, "audiooutput", "Default output"),
      });
      addDiagnosticEvent("info", `Joining voice call for ${conversationId}. Socket ${socket.connected ? "connected" : "not connected yet"}.`);
      await getPeerConfig();
      setIsInCall(true);
      setCallConversationId(conversationId);
      socket.emit("voice:join", { conversationId });
      await startRelayCapture(stream, conversationId);

      // Set up speaking detection for local user (do not connect to destination to prevent local feedback/echo)
      setupSpeakingDetection(currentUser?.id || socket.id || "local", stream, false);
      playJoinSound();
    } catch (err) {
      console.error("Failed to get microphone permissions:", err);
      useVoiceStore.getState().addDiagnosticEvent("error", err instanceof Error ? err.message : "Failed to get microphone permissions.");
      alert("Could not access microphone. Please check permissions.");
    }
  };

  // Handle leaving the call
  const leaveCall = () => {
    const socket = getSocket();
    socket.emit("voice:leave");

    // Stop local media tracks
    stopRelayCapture();
    closeRelayAudio();
    webRtcConnectedPeersSingleton.clear();
    webRtcAudioPeersSingleton.clear();

    if (localStreamSingleton) {
      localStreamSingleton.getTracks().forEach((track) => track.stop());
      localStreamSingleton = null;
    }
    if (localScreenStreamSingleton) {
      localScreenStreamSingleton.getTracks().forEach((track) => track.stop());
      localScreenStreamSingleton = null;
    }

    // Destroy all peers
    peersSingleton.forEach((peer) => peer.destroy());
    peersSingleton.clear();

    // Remove all audio elements
    audioElementsSingleton.forEach((audio) => {
      audio.pause();
      audio.remove();
    });
    audioElementsSingleton.clear();

    // Clean up all audio contexts
    audioContextsSingleton.forEach(({ analyser, cancelFrame }) => {
      cancelAnimationFrame(cancelFrame);
      try {
        analyser.disconnect();
      } catch (e) {}
    });
    audioContextsSingleton.clear();

    if (sharedAudioContext) {
      try {
        sharedAudioContext.close();
      } catch (e) {}
      sharedAudioContext = null;
    }

    // Clean up all GainNodes
    gainNodesSingleton.forEach((gainNode) => {
      try {
        gainNode.disconnect();
      } catch (e) {}
    });
    gainNodesSingleton.clear();

    playLeaveSound();
    setIsInCall(false);
    setIsScreensharing(false);
    setCallConversationId(null);
  };

  // Toggle mute
  const toggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    
    // Only play sound if muting
    if (nextMute) playMuteSound();
    else playUnmuteSound();

    if (localStreamSingleton) {
      localStreamSingleton.getAudioTracks().forEach((track) => {
        track.enabled = !nextMute;
      });
    }
  };

  // Screenshare
  const startScreenshare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true, // will capture system/tab audio if supported
      });

      localScreenStreamSingleton = stream;
      setIsScreensharing(true);
      playScreenshareSound();
      
      // Dispatch event for self-preview
      window.dispatchEvent(new CustomEvent('screenshare:self', { detail: { stream } }));

      // Handle user stopping screenshare via browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopScreenshare();
      };

      // Add stream to all active peer connections
      peersSingleton.forEach((peer) => {
        peer.addStream(stream);
      });
    } catch (err) {
      console.error("Could not start screenshare:", err);
    }
  };

  const stopScreenshare = () => {
    if (localScreenStreamSingleton) {
      // Remove stream from all peers
      peersSingleton.forEach((peer) => {
        try {
          peer.removeStream(localScreenStreamSingleton!);
        } catch (e) {
          // simple-peer throws if stream is not present
        }
      });
      localScreenStreamSingleton.getTracks().forEach((track) => track.stop());
      localScreenStreamSingleton = null;
    }
    setIsScreensharing(false);
  };

  const playLocalTestTone = async () => {
    const context = await getSharedAudioContext();
    if (!context) {
      addDiagnosticEvent("error", "Cannot play local test tone because Web Audio is unavailable.");
      return;
    }

    const duration = 0.7;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) {
      const t = i / context.sampleRate;
      const envelope = Math.min(1, i / 600) * Math.min(1, (channel.length - i) / 600);
      channel[i] = Math.sin(2 * Math.PI * 660 * t) * 0.35 * envelope;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    updateDiagnostics({ playbackContextState: context.state, lastPlaybackAt: Date.now() });
    addDiagnosticEvent("info", "Played local output test tone.");
  };

  const sendTestTone = () => {
    const socket = getSocket();
    const conversationId = useVoiceStore.getState().callConversationId || useMessageStore.getState().activeConversationId || "global";
    if (!useVoiceStore.getState().isInCall) {
      addDiagnosticEvent("warn", "Join a voice call before sending a remote test tone.");
      return;
    }

    addDiagnosticEvent("info", "Sending 1 second remote test tone through the voice relay.");
    updateDiagnostics({
      socketConnected: socket.connected,
      socketId: socket.id || null,
      socketTransport: (socket.io.engine as any)?.transport?.name || "unknown",
    });

    const frameDurationMs = 50;
    const frameCount = 20;
    for (let i = 0; i < frameCount; i++) {
      window.setTimeout(() => {
        emitRelayFrame(conversationId, createTonePcmFrame(880, frameDurationMs, i), "tone");
      }, i * frameDurationMs);
    }
  };

  const requestVoiceDiagnostics = () => {
    const socket = getSocket();
    const conversationId = useVoiceStore.getState().callConversationId || useMessageStore.getState().activeConversationId || "global";
    socket.emit("voice:diagnostics:get", { conversationId });
    updateDiagnostics({
      socketConnected: socket.connected,
      socketId: socket.id || null,
      socketTransport: (socket.io.engine as any)?.transport?.name || "unknown",
    });
    addDiagnosticEvent("info", "Requested server voice diagnostics snapshot.");
  };

  // Speaking detection using Web Audio API (AnalyserNode with requestAnimationFrame)
  const setupSpeakingDetection = (socketId: string, stream: MediaStream, playAudio = true) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      if (!sharedAudioContext) {
        sharedAudioContext = new AudioContextClass();
      }
      
      // Explicitly resume audio context to ensure it runs immediately
      if (sharedAudioContext.state === "suspended") {
        sharedAudioContext.resume().catch(console.error);
      }

      const source = sharedAudioContext.createMediaStreamSource(stream);
      const analyser = sharedAudioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.85;

      source.connect(analyser);

      // Create GainNode for volume adjustment (0% to 200%)
      const gainNode = sharedAudioContext.createGain();
      
      // Look up participant to get their userId
      const participant = useVoiceStore.getState().participants.find(p => p.socketId === socketId);
      const userId = participant?.userId;
      
      const saved = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("cozy_voice_user_volumes") || "{}") : {};
      const userVolumePercent = userId ? (saved[userId] ?? 100) : 100;
      gainNode.gain.setValueAtTime(userVolumePercent / 100, sharedAudioContext.currentTime);

      if (playAudio) {
        source.connect(gainNode);
        gainNode.connect(sharedAudioContext.destination);
      }

      gainNodesSingleton.set(socketId, gainNode);

      let speakingCounter = 0;
      let silentCounter = 0;
      let frameId: number;

      const array = new Uint8Array(analyser.frequencyBinCount);

      const update = () => {
        analyser.getByteFrequencyData(array);
        let values = 0;
        const length = array.length;
        for (let i = 0; i < length; i++) {
          values += array[i];
        }
        const average = values / length;

        // speaking threshold (volume average > 5 is highly responsive and sensitive)
        if (average > 5) {
          speakingCounter++;
          silentCounter = 0;
          if (speakingCounter > 1) {
            setSpeaking(socketId, true);
          }
        } else {
          silentCounter++;
          speakingCounter = 0;
          if (silentCounter > 12) {
            setSpeaking(socketId, false);
          }
        }

        frameId = requestAnimationFrame(update);
      };

      frameId = requestAnimationFrame(update);

      audioContextsSingleton.set(socketId, { audioContext: sharedAudioContext, analyser, cancelFrame: frameId });
    } catch (e) {
      console.warn("Could not set up speaking detection:", e);
    }
  };

  useEffect(() => {
    if (!isInCall) return;

    const socket = getSocket();
    const measurePing = () => {
      const sentAt = Date.now();
      socket.emit("voice:ping", { sentAt }, (response?: { sentAt?: number; serverAt?: number }) => {
        const echoSentAt = response?.sentAt || sentAt;
        updateDiagnostics({
          pingMs: Math.max(0, Date.now() - echoSentAt),
          socketConnected: socket.connected,
          socketId: socket.id || null,
          socketTransport: (socket.io.engine as any)?.transport?.name || "unknown",
        });
      });
    };
    measurePing();
    const pingInterval = window.setInterval(measurePing, 5000);

    // Triggered when a new user joins the voice channel
    const onUserJoined = async (participant: VoiceParticipant) => {
      if (!localStreamSingleton) return;
      const callConversationId = useVoiceStore.getState().callConversationId || "global";
      if ((participant.conversationId || "global") !== callConversationId) return;

      console.log("Creating initiator peer connection for user:", participant.displayName);
      playJoinSound();

      // Create an initiator peer
      const peer = new Peer({
        initiator: true,
        trickle: true,
        stream: localStreamSingleton,
        config: await getPeerConfig(),
      });
      attachPeerDiagnostics(peer, participant.socketId, `to ${participant.displayName}`);

      if (localScreenStreamSingleton) {
        peer.addStream(localScreenStreamSingleton);
      }

      peer.on("signal", (signal) => {
        socket.emit("voice:signal", {
          to: participant.socketId,
          conversationId: callConversationId,
          signal,
        });
      });

      peer.on("stream", (remoteStream) => {
        handleRemoteStream(participant.socketId, remoteStream);
      });

      peer.on("error", (err) => {
        console.error("Peer error:", err);
      });

      peer.on("close", () => {
        handlePeerClose(participant.socketId);
      });

      peersSingleton.set(participant.socketId, peer);
    };

    // Relay WebRTC signals
    const onSignal = async (data: { from: string; conversationId?: string; signal: any }) => {
      const callConversationId = useVoiceStore.getState().callConversationId || "global";
      if (data.conversationId && data.conversationId !== callConversationId) return;

      let peer = peersSingleton.get(data.from);

      if (!peer) {
        // We are receiving a connection offer from an initiator, so we create a receiver peer (initiator: false)
        console.log("Creating receiver peer connection from signal sender:", data.from);
        if (!localStreamSingleton) return;

        peer = new Peer({
          initiator: false,
          trickle: true,
          stream: localStreamSingleton,
          config: await getPeerConfig(),
        });
        attachPeerDiagnostics(peer, data.from, "from remote offer");

        if (localScreenStreamSingleton) {
          peer.addStream(localScreenStreamSingleton);
        }

        peer.on("signal", (signal) => {
          socket.emit("voice:signal", {
            to: data.from,
            conversationId: callConversationId,
            signal,
          });
        });

        peer.on("stream", (remoteStream) => {
          handleRemoteStream(data.from, remoteStream);
        });

        peer.on("error", (err) => {
          console.error("Peer error:", err);
        });

        peer.on("close", () => {
          handlePeerClose(data.from);
        });

        peersSingleton.set(data.from, peer);
      }

      peer.signal(data.signal);
    };

    // User left call
    const onUserLeft = (data: { conversationId?: string; socketId: string; userId: string }) => {
      const callConversationId = useVoiceStore.getState().callConversationId || "global";
      if (data.conversationId && data.conversationId !== callConversationId) return;

      handlePeerClose(data.socketId);
      playLeaveSound();
    };

    const onAudioFrame = (data: {
      from: string;
      conversationId?: string;
      sampleRate?: number;
      source?: "mic" | "tone";
      chunk: ArrayBuffer | Uint8Array;
    }) => {
      const callConversationId = useVoiceStore.getState().callConversationId || "global";
      if (!data?.from || data.conversationId !== callConversationId) return;
      if (data.from === socket.id) return;
      if (data.source === "mic" && webRtcAudioPeersSingleton.has(data.from)) {
        updateDiagnostics({
          relayMode: "standby",
          webRtcConnectedPeers: webRtcConnectedPeersSingleton.size,
          webRtcAudioPeers: webRtcAudioPeersSingleton.size,
        });
        return;
      }
      if (data.source === "tone") {
        addDiagnosticEvent("info", `Received remote test tone frame from ${data.from}.`);
      }
      playRelayAudioFrame(data.from, data.chunk, data.sampleRate || RELAY_SAMPLE_RATE).catch((err) => {
        addDiagnosticEvent("error", `Failed to play relayed audio frame: ${err instanceof Error ? err.message : String(err)}`);
      });
    };

    const onVoiceJoined = (data: { conversationId?: string; socketId?: string; participants?: VoiceParticipant[]; rooms?: string[] }) => {
      const callConversationId = useVoiceStore.getState().callConversationId || "global";
      if (data.conversationId && data.conversationId !== callConversationId) return;
      updateDiagnostics({
        socketId: data.socketId || socket.id || null,
        socketConnected: socket.connected,
        socketTransport: (socket.io.engine as any)?.transport?.name || "unknown",
        conversationId: data.conversationId || callConversationId,
      });
      addDiagnosticEvent("info", `Server accepted voice join. Participants: ${data.participants?.length ?? "unknown"}. Rooms: ${(data.rooms || []).join(", ") || "unknown"}.`);
    };

    const onRelayStats = (data: {
      conversationId?: string;
      framesReceived?: number;
      bytesReceived?: number;
      recipients?: number;
      droppedFrames?: number;
      reason?: string;
    }) => {
      const callConversationId = useVoiceStore.getState().callConversationId || "global";
      if (data.conversationId && data.conversationId !== callConversationId) return;
      updateDiagnostics({
        serverFramesReceived: data.framesReceived || 0,
        serverBytesReceived: data.bytesReceived || 0,
        serverRecipients: data.recipients || 0,
        serverDroppedFrames: data.droppedFrames || 0,
        lastServerAckAt: Date.now(),
      });
      if (data.reason) {
        addDiagnosticEvent("warn", `Server dropped an audio frame: ${data.reason}.`);
      }
    };

    const onDiagnosticEvent = (data: { level?: "info" | "warn" | "error"; message?: string }) => {
      if (data?.message) {
        addDiagnosticEvent(data.level || "info", data.message);
      }
    };

    const onDiagnosticsSnapshot = (data: any) => {
      addDiagnosticEvent(
        "info",
        `Server snapshot: active=${data.activeVoiceConversationId || "none"}, rooms=${(data.socketRooms || []).join(", ") || "none"}, participants=${data.participants?.length ?? 0}.`
      );
    };

    socket.on("voice:user-joined", onUserJoined);
    socket.on("voice:signal", onSignal);
    socket.on("voice:user-left", onUserLeft);
    socket.on("voice:audio-frame", onAudioFrame);
    socket.on("voice:joined", onVoiceJoined);
    socket.on("voice:relay-stats", onRelayStats);
    socket.on("voice:diagnostic-event", onDiagnosticEvent);
    socket.on("voice:diagnostics:snapshot", onDiagnosticsSnapshot);

    return () => {
      window.clearInterval(pingInterval);
      socket.off("voice:user-joined", onUserJoined);
      socket.off("voice:signal", onSignal);
      socket.off("voice:user-left", onUserLeft);
      socket.off("voice:audio-frame", onAudioFrame);
      socket.off("voice:joined", onVoiceJoined);
      socket.off("voice:relay-stats", onRelayStats);
      socket.off("voice:diagnostic-event", onDiagnosticEvent);
      socket.off("voice:diagnostics:snapshot", onDiagnosticsSnapshot);
    };
  }, [isInCall]);

  const handleRemoteStream = (socketId: string, stream: MediaStream) => {
    // Determine if this is a screen share stream (has video tracks)
    const isVideo = stream.getVideoTracks().length > 0;

    if (isVideo) {
      // Render screenshare video dynamically
      const existingVideo = document.getElementById(`screenshare-${socketId}`);
      if (existingVideo) existingVideo.remove();

      const video = document.createElement("video");
      video.id = `screenshare-${socketId}`;
      video.srcObject = stream;
      video.autoplay = true;
      video.setAttribute("playsinline", "true");
      
      // Screenshare video styles (floating PIP or full container depending on implementation)
      // The VoiceBanner/ChatPage will need to look for elements with this class/id and place them
      video.style.width = "100%";
      video.style.maxHeight = "400px";
      video.style.backgroundColor = "#000";
      video.style.borderRadius = "12px";
      video.style.objectFit = "contain";
      
      // We emit a custom event so React components can grab it
      const event = new CustomEvent('screenshare:new', { detail: { socketId, videoElement: video } });
      window.dispatchEvent(event);
      playScreenshareSound();

      // Handle stream removal
      stream.getTracks().forEach(track => {
        track.onended = () => {
          video.remove();
          window.dispatchEvent(new CustomEvent('screenshare:ended', { detail: { socketId } }));
        };
      });

      return;
    }

    // Audio-only (microphone) stream processing
    markWebRtcAudioActive(socketId);
    if (audioElementsSingleton.has(socketId)) {
      audioElementsSingleton.get(socketId)?.remove();
    }

    const audio = document.createElement("audio");
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.setAttribute("playsinline", "true");
    audio.muted = false; // CRITICAL: Keep unmuted so mobile browsers process audio tracks.

    // Set initial volume from saved user volume preference
    const participant = useVoiceStore.getState().participants.find(p => p.socketId === socketId);
    const userId = participant?.userId;
    const saved = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("cozy_voice_user_volumes") || "{}") : {};
    const userVolumePercent = userId ? (saved[userId] ?? 100) : 100;
    audio.volume = userVolumePercent / 100;

    if (selectedOutputDeviceId && typeof (audio as any).setSinkId === "function") {
      (audio as any).setSinkId(selectedOutputDeviceId).catch(console.error);
    }

    document.body.appendChild(audio);
    audioElementsSingleton.set(socketId, audio);

    // Explicitly play stream (crucial for mobile Chrome/Safari autoplay triggers)
    audio.play().catch((err) => {
      console.warn("Failed to play audio element directly, trying to play on user gesture:", err);
    });

    // Set up speaking detection on remote streams (playAudio = false to prevent double-playback echo)
    setupSpeakingDetection(socketId, stream, false);
  };

  // Sync volumes to both HTML5 AudioElements and Analyser GainNodes when they change
  useEffect(() => {
    Object.entries(volumes).forEach(([socketId, volumePercent]) => {
      // 1. Sync actual audio playback volume on HTML5 audio element
      const audio = audioElementsSingleton.get(socketId);
      if (audio) {
        audio.volume = volumePercent / 100;
      }

      // 2. Keep GainNode in sync for speaking analysis level
      const gainNode = gainNodesSingleton.get(socketId);
      if (gainNode) {
        gainNode.gain.setTargetAtTime(volumePercent / 100, gainNode.context.currentTime, 0.01);
      }

      const relayGainNode = relayGainNodesSingleton.get(socketId);
      if (relayGainNode) {
        relayGainNode.gain.setTargetAtTime(volumePercent / 100, relayGainNode.context.currentTime, 0.01);
      }
    });
  }, [volumes]);

  // Sync output device when it changes
  useEffect(() => {
    if (selectedOutputDeviceId) {
      audioElementsSingleton.forEach((audio) => {
        if (typeof (audio as any).setSinkId === "function") {
          (audio as any).setSinkId(selectedOutputDeviceId).catch(console.error);
        }
      });
    }
  }, [selectedOutputDeviceId]);

  // Enumerate devices on mount and listen for changes
  useEffect(() => {
    const updateDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAvailableDevices(devices);
      } catch (err) {
        console.error("Failed to enumerate devices:", err);
      }
    };

    updateDevices();
    navigator.mediaDevices.addEventListener("devicechange", updateDevices);

    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", updateDevices);
    };
  }, []);

  const handlePeerClose = (socketId: string) => {
    const peer = peersSingleton.get(socketId);
    if (peer) {
      peer.destroy();
      peersSingleton.delete(socketId);
    }
    webRtcConnectedPeersSingleton.delete(socketId);
    webRtcAudioPeersSingleton.delete(socketId);
    updateDiagnostics({
      webRtcConnectedPeers: webRtcConnectedPeersSingleton.size,
      webRtcAudioPeers: webRtcAudioPeersSingleton.size,
      relayMode: shouldSendRelayMic() ? "active" : "standby",
    });

    const audio = audioElementsSingleton.get(socketId);
    if (audio) {
      audio.pause();
      audio.remove();
      audioElementsSingleton.delete(socketId);
    }

    const analysis = audioContextsSingleton.get(socketId);
    if (analysis) {
      cancelAnimationFrame(analysis.cancelFrame);
      try {
        analysis.analyser.disconnect();
      } catch (e) {}
      // DO NOT close analysis.audioContext because it is shared!
      audioContextsSingleton.delete(socketId);
    }

    const gainNode = gainNodesSingleton.get(socketId);
    if (gainNode) {
      try {
        gainNode.disconnect();
      } catch (e) {}
      gainNodesSingleton.delete(socketId);
    }

    closeRelayAudio(socketId);
    setSpeaking(socketId, false);
  };

  return {
    joinCall,
    leaveCall,
    toggleMute,
    startScreenshare,
    stopScreenshare,
    playLocalTestTone,
    sendTestTone,
    requestVoiceDiagnostics,
    isInCall,
    isMuted,
    isScreensharing,
  };
}
