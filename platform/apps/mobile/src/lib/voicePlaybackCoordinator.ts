export type VoicePlaybackSpeed = 1 | 1.5 | 2;

interface VoiceController {
  pause: () => void;
  play: () => void;
  setRate: (rate: VoicePlaybackSpeed) => void;
  seekTo?: (seconds: number) => void;
}

export interface VoicePlaybackSnapshot {
  requestedKey: string | null;
  speed: VoicePlaybackSpeed;
}

export interface VoicePlaybackProgressSnapshot {
  key: string | null;
  currentSeconds: number;
  durationSeconds: number;
  playing: boolean;
}

const queues = new Map<string, readonly string[]>();
const controllers = new Map<string, VoiceController>();
const listeners = new Set<() => void>();
const progressListeners = new Set<() => void>();
let currentKey: string | null = null;
let snapshot: VoicePlaybackSnapshot = { requestedKey: null, speed: 1 };
let progressSnapshot: VoicePlaybackProgressSnapshot = {
  key: null,
  currentSeconds: 0,
  durationSeconds: 0,
  playing: false,
};

const keyFor = (streamId: string, attachmentId: string) => `${streamId}:${attachmentId}`;

export function voicePlaybackSnapshot(): VoicePlaybackSnapshot {
  return snapshot;
}

export function subscribeVoicePlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function voicePlaybackProgressSnapshot(): VoicePlaybackProgressSnapshot {
  return progressSnapshot;
}

export function subscribeVoicePlaybackProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export function updateVoicePlaybackProgress(key: string, currentSeconds: number, durationSeconds: number, playing: boolean): void {
  if (snapshot.requestedKey !== key) return;
  const next = { key, currentSeconds, durationSeconds, playing };
  if (progressSnapshot.key === key && progressSnapshot.currentSeconds === currentSeconds && progressSnapshot.durationSeconds === durationSeconds && progressSnapshot.playing === playing) return;
  progressSnapshot = next;
  for (const listener of progressListeners) listener();
}

export function seekVoicePlayback(seconds: number): void {
  if (!currentKey) return;
  controllers.get(currentKey)?.seekTo?.(Math.max(0, seconds));
}

export function toggleCurrentVoicePlayback(): void {
  if (!currentKey) return;
  if (progressSnapshot.playing) controllers.get(currentKey)?.pause();
  else controllers.get(currentKey)?.play();
}

export function setVoicePlaybackQueue(streamId: string, attachmentIds: readonly string[]): void {
  queues.set(streamId, [...new Set(attachmentIds)]);
}

export function clearVoicePlaybackQueue(streamId: string): void {
  queues.delete(streamId);
  if (snapshot.requestedKey?.startsWith(`${streamId}:`)) stopVoicePlayback();
}

export function registerVoiceController(streamId: string, attachmentId: string, controller: VoiceController): () => void {
  const key = keyFor(streamId, attachmentId);
  controllers.set(key, controller);
  controller.setRate(snapshot.speed);
  if (snapshot.requestedKey === key) {
    currentKey = key;
    controller.play();
  }
  return () => {
    if (controllers.get(key) === controller) controllers.delete(key);
  };
}

export function requestVoicePlayback(streamId: string, attachmentId: string): void {
  const key = keyFor(streamId, attachmentId);
  if (currentKey && currentKey !== key) controllers.get(currentKey)?.pause();
  currentKey = key;
  if (progressSnapshot.key !== key) {
    progressSnapshot = {
      key,
      currentSeconds: 0,
      durationSeconds: 0,
      playing: false,
    };
    for (const listener of progressListeners) listener();
  }
  updateSnapshot({ ...snapshot, requestedKey: key });
  controllers.get(key)?.play();
}

export function pauseVoicePlayback(streamId: string, attachmentId: string): void {
  controllers.get(keyFor(streamId, attachmentId))?.pause();
}

export function completeVoicePlayback(streamId: string, attachmentId: string): void {
  const queue = queues.get(streamId) ?? [];
  const index = queue.indexOf(attachmentId);
  const next = index >= 0 ? queue[index + 1] : undefined;
  if (next) {
    requestVoicePlayback(streamId, next);
    return;
  }
  stopVoicePlayback();
}

export function stopVoicePlayback(): void {
  if (currentKey) controllers.get(currentKey)?.pause();
  currentKey = null;
  progressSnapshot = {
    key: null,
    currentSeconds: 0,
    durationSeconds: 0,
    playing: false,
  };
  for (const listener of progressListeners) listener();
  updateSnapshot({ ...snapshot, requestedKey: null });
}

export function cycleVoicePlaybackSpeed(): VoicePlaybackSpeed {
  const speed: VoicePlaybackSpeed = snapshot.speed === 1 ? 1.5 : snapshot.speed === 1.5 ? 2 : 1;
  updateSnapshot({ ...snapshot, speed });
  if (currentKey) controllers.get(currentKey)?.setRate(speed);
  return speed;
}

export function resetVoicePlaybackForTests(): void {
  queues.clear();
  controllers.clear();
  listeners.clear();
  progressListeners.clear();
  currentKey = null;
  snapshot = { requestedKey: null, speed: 1 };
  progressSnapshot = {
    key: null,
    currentSeconds: 0,
    durationSeconds: 0,
    playing: false,
  };
}

function updateSnapshot(next: VoicePlaybackSnapshot): void {
  if (snapshot.requestedKey === next.requestedKey && snapshot.speed === next.speed) return;
  snapshot = next;
  for (const listener of listeners) listener();
}
