import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, ChevronDown, Mic, MicOff, MonitorUp, MoreHorizontal, PhoneOff, Settings2, Volume2 } from "lucide-react";
import type { Participant } from "livekit-client";
import { useApp } from "../state/AppContext.js";
import { useCall } from "../state/CallContext.js";
import { Avatar, IconButton } from "./ui.js";

export function CallSurface() {
  const app = useApp();
  const call = useCall();
  const [moreOpen, setMoreOpen] = useState(false);
  const [resolution, setResolution] = useState("1080");
  const [frameRate, setFrameRate] = useState("30");
  const [optimize, setOptimize] = useState("motion");
  if (!call.surfaceOpen || !call.roomId) return null;

  return (
    <section className="call-surface" aria-label={`Call in ${call.title}`}>
      <header className="call-header">
        <div><strong>{call.title}</strong><small>{call.status === "connected" ? `${call.participants.length} connected` : call.status === "failed" ? call.error || "Connection failed." : `${call.status}...`}</small></div>
        <button className="button button-secondary" onClick={() => call.setSurfaceOpen(false)}><ChevronDown /> Return to chat</button>
      </header>
      <div className={`participant-grid participant-count-${Math.min(call.participants.length, 6)}`}>
        {call.participants.map((participant) => <ParticipantTile key={participant.identity} participant={participant} active={call.activeSpeakerIds.has(participant.identity)} localIdentity={call.room?.localParticipant.identity || ""} />)}
        {call.participants.length === 0 && <p>Connecting...</p>}
      </div>
      {call.status === "reconnecting" && <div className="call-state-banner">Reconnecting...</div>}
      {call.status === "failed" && <div className="call-state-banner is-error"><span>{call.error || "Call connection failed."}</span><button className="button button-secondary" onClick={() => void call.join(call.roomId!, call.title)}>Retry</button></div>}
      <div className="call-controls" aria-label="Call controls">
        <CallControl label={call.muted ? "Unmute" : "Mute"} active={call.muted} onClick={() => void call.toggleMute()} icon={call.muted ? <MicOff /> : <Mic />} />
        <CallControl label={call.cameraEnabled ? "Stop camera" : "Camera"} active={!call.cameraEnabled} onClick={() => void call.toggleCamera()} icon={call.cameraEnabled ? <Camera /> : <CameraOff />} />
        <CallControl label={call.screenSharing ? "Stop sharing" : "Share"} active={call.screenSharing} onClick={() => void call.toggleScreenShare()} icon={<MonitorUp />} />
        <CallControl label="Audio route" onClick={() => app.setSettingsOpen(true)} icon={<Volume2 />} />
        <div className="call-more-anchor"><CallControl label="More" active={moreOpen} onClick={() => setMoreOpen(!moreOpen)} icon={<MoreHorizontal />} />{moreOpen && <div className="call-quality-menu"><strong>Screen share</strong><label>Resolution<select value={resolution} onChange={(event) => setResolution(event.target.value)}><option value="720">720p</option><option value="1080">1080p</option><option value="1440">1440p</option></select></label><label>Frame rate<select value={frameRate} onChange={(event) => setFrameRate(event.target.value)}><option value="15">15 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label><label>Optimize for<select value={optimize} onChange={(event) => setOptimize(event.target.value)}><option value="motion">Motion</option><option value="text">Text</option></select></label><button onClick={() => app.setSettingsOpen(true)}><Settings2 /> Voice settings</button></div>}</div>
        <CallControl label="Leave" danger onClick={() => { void call.leave(); }} icon={<PhoneOff />} />
      </div>
    </section>
  );
}

function CallControl({ label, icon, onClick, active = false, danger = false }: { label: string; icon: React.ReactNode; onClick: () => void; active?: boolean; danger?: boolean }) {
  return <button className={`call-control ${active ? "is-active" : ""} ${danger ? "is-danger" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function ParticipantTile({ participant, active, localIdentity }: { participant: Participant; active: boolean; localIdentity: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const publications = Array.from(participant.trackPublications.values());
  const video = publications.find((publication) => publication.track?.kind === "video" && publication.source === "screen_share")
    || publications.find((publication) => publication.track?.kind === "video");
  const audio = publications.find((publication) => publication.track?.kind === "audio");
  const metadata = parseMetadata(participant.metadata);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !video?.track) return;
    video.track.attach(element);
    return () => { video.track?.detach(element); };
  }, [video?.track]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element || !audio?.track || participant.identity === localIdentity) return;
    audio.track.attach(element);
    return () => { audio.track?.detach(element); };
  }, [audio?.track, localIdentity, participant.identity]);

  const name = metadata.displayName || participant.name || participant.identity;
  return <article className={`participant-tile ${active ? "is-speaking" : ""} ${video?.source === "screen_share" ? "is-screen" : ""}`}>
    {video ? <video ref={videoRef} autoPlay playsInline muted={participant.identity === localIdentity} /> : <Avatar name={name} url={metadata.avatarUrl} color={metadata.avatarColor} size={80} />}
    <audio ref={audioRef} autoPlay />
    <span className="participant-name">{name}{participant.identity === localIdentity ? " (you)" : ""}</span>
    {!audio && <MicOff className="participant-muted" aria-label="Muted" />}
  </article>;
}

function parseMetadata(metadata?: string) {
  try { return JSON.parse(metadata || "{}") as { displayName?: string; avatarUrl?: string; avatarColor?: string }; }
  catch { return {} as { displayName?: string; avatarUrl?: string; avatarColor?: string }; }
}
