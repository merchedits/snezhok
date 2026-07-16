export const VOICE_CANCEL_DISTANCE = 92;
export const VOICE_LOCK_DISTANCE = 78;

export type VoiceGestureDecision = "holding" | "cancel" | "lock";

/** Telegram-style recording gesture: horizontal movement wins when both axes cross. */
export function voiceGestureDecision(dx: number, dy: number): VoiceGestureDecision {
  const cancelProgress = Math.max(0, -dx) / VOICE_CANCEL_DISTANCE;
  const lockProgress = Math.max(0, -dy) / VOICE_LOCK_DISTANCE;
  if (cancelProgress >= 1 || lockProgress >= 1) return cancelProgress >= lockProgress ? "cancel" : "lock";
  return "holding";
}

export function voiceGestureProgress(dx: number, dy: number): { cancel: number; lock: number } {
  return {
    cancel: clamp01(Math.max(0, -dx) / VOICE_CANCEL_DISTANCE),
    lock: clamp01(Math.max(0, -dy) / VOICE_LOCK_DISTANCE),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
