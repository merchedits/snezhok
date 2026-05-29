import { useEffect } from "react";
import Peer from "simple-peer";
import { getSocket } from "../lib/socket.js";
import { useVoiceStore, VoiceParticipant } from "../stores/voiceStore.js";
import { playJoinSound, playLeaveSound, playMuteSound } from "../lib/sounds.js";

// Module-level singletons to ensure voice state is shared across all components calling useVoice()
let localStreamSingleton: MediaStream | null = null;
let localScreenStreamSingleton: MediaStream | null = null;
const peersSingleton = new Map<string, Peer.Instance>(); // socketId -> Peer instance
const audioElementsSingleton = new Map<string, HTMLAudioElement>(); // socketId -> Audio element
const audioContextsSingleton = new Map<string, { audioContext: AudioContext; analyser: AnalyserNode; cancelFrame: number }>(); // socketId -> Audio analysis nodes

export function useVoice() {
  const { 
    isInCall, isMuted, isScreensharing, setIsInCall, setIsMuted, setIsScreensharing, setSpeaking,
    selectedInputDeviceId, selectedOutputDeviceId, volumes, setAvailableDevices 
  } = useVoiceStore();

  // Handle joining a voice call
  const joinCall = async () => {
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
      setIsInCall(true);
      socket.emit("voice:join");

      // Set up speaking detection for local user
      setupSpeakingDetection("local", stream);
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
    audioContextsSingleton.forEach(({ audioContext, analyser, cancelFrame }) => {
      cancelAnimationFrame(cancelFrame);
      analyser.disconnect();
      audioContext.close();
    });
    audioContextsSingleton.clear();

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
  const setupSpeakingDetection = (socketId: string, stream: MediaStream) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.85;

      source.connect(analyser);

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

        // speaking threshold (volume average > 12 is typical voice level)
        if (average > 12) {
          speakingCounter++;
          silentCounter = 0;
          if (speakingCounter > 2) {
            setSpeaking(socketId, true);
          }
        } else {
          silentCounter++;
          speakingCounter = 0;
          if (silentCounter > 15) {
            setSpeaking(socketId, false);
          }
        }

        frameId = requestAnimationFrame(update);
      };

      frameId = requestAnimationFrame(update);

      audioContextsSingleton.set(socketId, { audioContext, analyser, cancelFrame: frameId });
    } catch (e) {
      console.warn("Could not set up speaking detection:", e);
    }
  };

  useEffect(() => {
    if (!isInCall) return;

    const socket = getSocket();

    // Triggered when a new user joins the voice channel
    const onUserJoined = (participant: VoiceParticipant) => {
      if (!localStreamSingleton) return;

      console.log("Creating initiator peer connection for user:", participant.displayName);
      playJoinSound();

      // Create an initiator peer
      const peer = new Peer({
        initiator: true,
        trickle: true,
        stream: localStreamSingleton,
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
    const onSignal = (data: { from: string; signal: any }) => {
      let peer = peersSingleton.get(data.from);

      if (!peer) {
        // We are receiving a connection offer from an initiator, so we create a receiver peer (initiator: false)
        console.log("Creating receiver peer connection from signal sender:", data.from);
        if (!localStreamSingleton) return;

        peer = new Peer({
          initiator: false,
          trickle: true,
          stream: localStreamSingleton,
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

    // Apply current volume and output device if set
    if (volumes[socketId] !== undefined) {
      audio.volume = volumes[socketId];
    }
    if (selectedOutputDeviceId && typeof (audio as any).setSinkId === "function") {
      (audio as any).setSinkId(selectedOutputDeviceId).catch(console.error);
    }

    document.body.appendChild(audio);
    audioElementsSingleton.set(socketId, audio);

    // Set up speaking detection on remote streams
    setupSpeakingDetection(socketId, stream);
  };

  // Sync volumes to audio elements when they change
  useEffect(() => {
    Object.entries(volumes).forEach(([socketId, volume]) => {
      const audio = audioElementsSingleton.get(socketId);
      if (audio) {
        audio.volume = volume;
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
      analysis.analyser.disconnect();
      analysis.audioContext.close();
      audioContextsSingleton.delete(socketId);
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
