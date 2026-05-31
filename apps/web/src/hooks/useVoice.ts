import { useEffect } from "react";
import Peer from "simple-peer";
import { getSocket } from "../lib/socket.js";
import { useVoiceStore, VoiceParticipant } from "../stores/voiceStore.js";
import { useAuthStore } from "../stores/authStore.js";
import { playJoinSound, playLeaveSound, playMuteSound, playUnmuteSound, playScreenshareSound } from "../lib/sounds.js";

// Module-level singletons to ensure voice state is shared across all components calling useVoice()
let localStreamSingleton: MediaStream | null = null;
let localScreenStreamSingleton: MediaStream | null = null;
const peersSingleton = new Map<string, Peer.Instance>(); // socketId -> Peer instance
const audioElementsSingleton = new Map<string, HTMLAudioElement>(); // socketId -> Audio element
const audioContextsSingleton = new Map<string, { audioContext: AudioContext; analyser: AnalyserNode; cancelFrame: number }>(); // socketId -> Audio analysis nodes
const gainNodesSingleton = new Map<string, GainNode>(); // socketId -> GainNode
let peerConfigSingleton: { iceServers: RTCIceServer[] } | null = null;
let sharedAudioContext: AudioContext | null = null;

async function getPeerConfig() {
  if (peerConfigSingleton) return peerConfigSingleton;

  try {
    const res = await fetch("/api/rtc-config");
    if (res.ok) {
      const data = await res.json();
      peerConfigSingleton = { iceServers: Array.isArray(data.iceServers) ? data.iceServers : [] };
      return peerConfigSingleton;
    }
  } catch (err) {
    console.warn("Could not load RTC config:", err);
  }

  peerConfigSingleton = { iceServers: [] };
  return peerConfigSingleton;
}

export function useVoice() {
  const { 
    isInCall, isMuted, isScreensharing, setIsInCall, setIsMuted, setIsScreensharing, setSpeaking,
    selectedInputDeviceId, selectedOutputDeviceId, volumes, setAvailableDevices 
  } = useVoiceStore();
  const { user: currentUser } = useAuthStore();

  // Handle joining a voice call
  const joinCall = async () => {
    if (useVoiceStore.getState().isInCall) {
      return;
    }
    try {
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
      await getPeerConfig();
      setIsInCall(true);
      socket.emit("voice:join");

      // Set up speaking detection for local user
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

      console.log("Creating initiator peer connection for user:", participant.displayName);
      playJoinSound();

      // Create an initiator peer
      const peer = new Peer({
        initiator: true,
        trickle: true,
        stream: localStreamSingleton,
        config: await getPeerConfig(),
      });

      if (localScreenStreamSingleton) {
        peer.addStream(localScreenStreamSingleton);
      }

      peer.on("signal", (signal) => {
        socket.emit("voice:signal", {
          to: participant.socketId,
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
    const onSignal = async (data: { from: string; signal: any }) => {
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

        if (localScreenStreamSingleton) {
          peer.addStream(localScreenStreamSingleton);
        }

        peer.on("signal", (signal) => {
          socket.emit("voice:signal", {
            to: data.from,
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
    const onUserLeft = (data: { socketId: string; userId: string }) => {
      handlePeerClose(data.socketId);
      playLeaveSound();
    };

    socket.on("voice:user-joined", onUserJoined);
    socket.on("voice:signal", onSignal);
    socket.on("voice:user-left", onUserLeft);

    return () => {
      socket.off("voice:user-joined", onUserJoined);
      socket.off("voice:signal", onSignal);
      socket.off("voice:user-left", onUserLeft);
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
    audio.muted = false; // CRITICAL: DO NOT MUTE! Let HTML5 audio play directly to bypass iOS/Android autoplay policy.

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

    // Set up speaking detection on remote streams (playAudio = false to prevent double playback)
    setupSpeakingDetection(socketId, stream, false);
  };

  // Sync volumes to AudioElements and GainNodes when they change
  useEffect(() => {
    Object.entries(volumes).forEach(([socketId, volumePercent]) => {
      // 1. Sync HTML5 audio element volume (which handles actual playback)
      const audio = audioElementsSingleton.get(socketId);
      if (audio) {
        audio.volume = volumePercent / 100;
      }

      // 2. Keep GainNode in sync (which handles speaking analysis)
      const gainNode = gainNodesSingleton.get(socketId);
      if (gainNode) {
        // Smoothly transition volume to avoid clicks/pops
        gainNode.gain.setTargetAtTime(volumePercent / 100, gainNode.context.currentTime, 0.01);
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
