import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Lock, Mic, Send, Trash2, Video } from "lucide-react";
import { IconButton } from "./ui.js";

export function RecordControl({ disabled, onRecorded }: { disabled: boolean; onRecorded: (file: File, kind: "voice" | "video-note") => Promise<void> }) {
  const [kind, setKind] = useState<"voice" | "video-note">("voice");
  const [recording, setRecording] = useState(false);
  const [locked, setLocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const clock = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const intent = useRef<"none" | "send" | "cancel">("none");
  const releaseRequested = useRef(false);
  const starting = useRef(false);
  const disposed = useRef(false);
  const generation = useRef(0);

  const cleanup = (updateUi = true) => {
    if (clock.current) window.clearInterval(clock.current);
    clock.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
    starting.current = false;
    if (updateUi && !disposed.current) {
      setRecording(false);
      setLocked(false);
      setElapsed(0);
    }
  };

  useEffect(() => () => {
    disposed.current = true;
    generation.current += 1;
    intent.current = "cancel";
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const activeRecorder = recorder.current;
    if (activeRecorder) {
      activeRecorder.ondataavailable = null;
      activeRecorder.onstop = null;
      if (activeRecorder.state === "recording") activeRecorder.stop();
    }
    cleanup(false);
  }, []);

  const start = async () => {
    const operation = ++generation.current;
    starting.current = true;
    try {
      const activeStream = await navigator.mediaDevices.getUserMedia(kind === "voice" ? { audio: true } : { audio: true, video: { width: 720, height: 720 } });
      if (disposed.current || operation !== generation.current || intent.current === "cancel") {
        activeStream.getTracks().forEach((track) => track.stop());
        cleanup();
        return;
      }
      stream.current = activeStream;
      const preferred = kind === "voice" ? "audio/webm;codecs=opus" : "video/webm;codecs=vp9,opus";
      const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : kind === "voice" ? "audio/webm" : "video/webm";
      const activeRecorder = new MediaRecorder(activeStream, { mimeType });
      recorder.current = activeRecorder;
      chunks.current = [];
      activeRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      activeRecorder.onstop = () => {
        const shouldSend = !disposed.current && intent.current !== "cancel" && chunks.current.length > 0;
        const blob = new Blob(chunks.current, { type: mimeType });
        cleanup();
        if (shouldSend) {
          const extension = kind === "voice" ? "webm" : "webm";
          void onRecorded(new File([blob], `${kind}-${Date.now()}.${extension}`, { type: mimeType }), kind);
        }
      };
      activeRecorder.start(250);
      starting.current = false;
      setRecording(true);
      const startedAt = Date.now();
      clock.current = window.setInterval(() => setElapsed(Date.now() - startedAt), 200);
      if (releaseRequested.current) stop(intent.current !== "send");
    } catch {
      cleanup();
    }
  };

  const stop = (cancel: boolean) => {
    if (cancel || intent.current !== "cancel") intent.current = cancel ? "cancel" : "send";
    if (recorder.current?.state === "recording") recorder.current.stop();
    else releaseRequested.current = true;
  };

  const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY };
    intent.current = "none";
    releaseRequested.current = false;
    timer.current = window.setTimeout(() => { timer.current = null; void start(); }, 220);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!recording) return;
    const dx = event.clientX - origin.current.x;
    const dy = event.clientY - origin.current.y;
    if (dx < -80) stop(true);
    if (dy < -80) setLocked(true);
  };

  const pointerUp = () => {
    const tapped = timer.current !== null;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (tapped) {
      setKind((current) => current === "voice" ? "video-note" : "voice");
      return;
    }
    if (starting.current) {
      if (intent.current !== "cancel") intent.current = "send";
      releaseRequested.current = true;
      return;
    }
    if (!locked) stop(false);
  };

  if (recording && locked) return <div className="locked-recorder"><span className="recording-dot" /><time>{formatElapsed(elapsed)}</time><Lock /><IconButton label="Delete recording" onClick={() => stop(true)}><Trash2 /></IconButton><IconButton label="Send recording" className="send-button" onClick={() => stop(false)}><Send /></IconButton></div>;

  return <button type="button" className={`icon-button record-button ${recording ? "is-recording" : ""}`} aria-label={recording ? "Release to send, slide left to cancel, or slide up to lock" : kind === "voice" ? "Hold to record voice note. Tap for video note." : "Hold to record video note. Tap for voice note."} disabled={disabled} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => stop(true)}>{kind === "voice" ? <Mic /> : <Video />}{recording && <span className="recording-time">{formatElapsed(elapsed)}</span>}</button>;
}

function formatElapsed(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
