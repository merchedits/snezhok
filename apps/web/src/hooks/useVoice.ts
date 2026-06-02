import { useEffect } from "react";
import Peer from "simple-peer";
import { getSocket } from "../lib/socket.js";
import { useVoiceStore, VoiceParticipant } from "../stores/voiceStore.js";
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
let peerConfigSingleton: RTCConfiguration | null = null;
let sharedAudioContext: AudioContext | null = null;
let relayCaptureContextSingleton: AudioContext | null = null;
let relayCaptureProcessorSingleton: ScriptProcessorNode | null = null;
let relayCaptureSourceSingleton: MediaStreamAudioSourceNode | null = null;
let relayCaptureMutedGainSingleton: GainNode | null = null;
let relaySequenceSingleton = 0;
const RELAY_SAMPLE_RATE = 16000;
const RELAY_BUFFER_SIZE = 4096;

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
    console.warn("[voice] Web Audio is unavailable; falling back to WebRTC only.");
    return;
  }

  const socket = getSocket();
  relayCaptureContextSingleton = new AudioContextClass();
  if (relayCaptureContextSingleton.state === "suspended") {
    await relayCaptureContextSingleton.resume().catch(console.error);
  }

  relayCaptureSourceSingleton = relayCaptureContextSingleton.createMediaStreamSource(stream);
  relayCaptureProcessorSingleton = relayCaptureContextSingleton.createScriptProcessor(RELAY_BUFFER_SIZE, 1, 1);
  relayCaptureMutedGainSingleton = relayCaptureContextSingleton.createGain();
  relayCaptureMutedGainSingleton.gain.value = 0;

  relayCaptureProcessorSingleton.onaudioprocess = (event) => {
    if (useVoiceStore.getState().isMuted) return;
    const input = event.inputBuffer.getChannelData(0);
    const chunk = floatTo16BitPcm(input, relayCaptureContextSingleton!.sampleRate, RELAY_SAMPLE_RATE);
    socket.emit("voice:audio-frame", {
      conversationId,
      sampleRate: RELAY_SAMPLE_RATE,
      channels: 1,
      sequence: relaySequenceSingleton++,
      sentAt: Date.now(),
      chunk,
    });
  };

  relayCaptureSourceSingleton.connect(relayCaptureProcessorSingleton);
  relayCaptureProcessorSingleton.connect(relayCaptureMutedGainSingleton);
  relayCaptureMutedGainSingleton.connect(relayCaptureContextSingleton.destination);
  console.info("[voice] Started server-relayed PCM audio.");
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
  if (!context) return;

  if (typeof (context as any).setSinkId === "function") {
    const outputId = useVoiceStore.getState().selectedOutputDeviceId;
    if (outputId) {
      (context as any).setSinkId(outputId).catch(console.error);
    }
  }

  const pcm = new Int16Array(toArrayBuffer(chunk));
  if (pcm.length === 0) return;

  const audioBuffer = context.createBuffer(1, pcm.length, sampleRate || RELAY_SAMPLE_RATE);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) {
    channel[i] = Math.max(-1, Math.min(1, pcm[i] / 32768));
  }

  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(getRelayGainNode(socketId, context));

  let nextTime = relayPlaybackPositionsSingleton.get(socketId) ?? context.currentTime + 0.08;
  if (nextTime < context.currentTime + 0.03 || nextTime > context.currentTime + 1.2) {
    nextTime = context.currentTime + 0.08;
  }

  source.start(nextTime);
  relayPlaybackPositionsSingleton.set(socketId, nextTime + audioBuffer.duration);

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
        noiseSuppression: true,
        autoGainControl: true,
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
      chunk: ArrayBuffer | Uint8Array;
    }) => {
      const callConversationId = useVoiceStore.getState().callConversationId || "global";
      if (!data?.from || data.conversationId !== callConversationId) return;
      if (data.from === socket.id) return;
      playRelayAudioFrame(data.from, data.chunk, data.sampleRate || RELAY_SAMPLE_RATE).catch((err) => {
        console.warn("[voice] Failed to play relayed audio frame:", err);
      });
    };

    socket.on("voice:user-joined", onUserJoined);
    socket.on("voice:signal", onSignal);
    socket.on("voice:user-left", onUserLeft);
    socket.on("voice:audio-frame", onAudioFrame);

    return () => {
      socket.off("voice:user-joined", onUserJoined);
      socket.off("voice:signal", onSignal);
      socket.off("voice:user-left", onUserLeft);
      socket.off("voice:audio-frame", onAudioFrame);
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
    isInCall,
    isMuted,
    isScreensharing,
  };
}
