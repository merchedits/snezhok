export type AudioSessionPurpose = "voice-playback" | "voice-recording" | "call";

export interface AudioSessionLease {
  readonly purpose: AudioSessionPurpose;
  readonly key: string;
  readonly generation: number;
}

interface AudioSessionClaim {
  lease: AudioSessionLease;
  onPreempt?: () => void | Promise<void>;
}

let generation = 0;
let current: AudioSessionClaim | null = null;
let operationQueue: Promise<void> = Promise.resolve();

const priority: Record<AudioSessionPurpose, number> = {
  "voice-playback": 1,
  "voice-recording": 2,
  call: 3,
};

/**
 * Owns the process-wide native audio focus contract.
 *
 * Expo Audio and LiveKit both mutate Android's audio mode. Without a single
 * arbiter, a recorder cleanup can reset MODE_IN_COMMUNICATION after a call has
 * already started. Higher-priority sessions preempt lower-priority sessions;
 * equal-priority playback claims may replace one another.
 */
export function claimAudioSession(
  purpose: AudioSessionPurpose,
  key: string,
  onPreempt?: () => void | Promise<void>,
): AudioSessionLease | null {
  if (current?.lease.purpose === purpose && current.lease.key === key) return current.lease;
  if (current && priority[purpose] < priority[current.lease.purpose]) return null;
  if (current && priority[purpose] === priority[current.lease.purpose] && purpose !== "voice-playback") return null;

  const previous = current;
  const lease = { purpose, key, generation: ++generation } satisfies AudioSessionLease;
  current = { lease, ...(onPreempt ? { onPreempt } : {}) };
  const preemption = previous?.onPreempt?.();
  if (preemption) {
    operationQueue = operationQueue.then(() => preemption, () => preemption).then(() => undefined, () => undefined);
  }
  return lease;
}

export function ownsAudioSession(lease: AudioSessionLease | null | undefined): boolean {
  return Boolean(lease && current?.lease.generation === lease.generation);
}

export function audioSessionPurpose(): AudioSessionPurpose | null {
  return current?.lease.purpose ?? null;
}

/** Serializes native audio-mode mutations and skips stale owners. */
export function runAudioSessionOperation<T>(lease: AudioSessionLease, operation: () => Promise<T>): Promise<T | undefined> {
  return enqueue(async () => {
    if (!ownsAudioSession(lease)) return undefined;
    return operation();
  });
}

/**
 * Runs owner-specific native cleanup before releasing the lease. A newer owner
 * makes this cleanup a no-op, preventing stale unmount work from clobbering it.
 */
export function releaseAudioSession(
  lease: AudioSessionLease | null | undefined,
  cleanup?: () => Promise<void>,
): Promise<boolean> {
  if (!lease) return Promise.resolve(false);
  return enqueue(async () => {
    if (!ownsAudioSession(lease)) return false;
    try {
      await cleanup?.();
    } finally {
      if (ownsAudioSession(lease)) current = null;
    }
    return true;
  });
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function resetAudioSessionOwnershipForTests(): Promise<void> {
  await operationQueue;
  current = null;
  generation = 0;
  operationQueue = Promise.resolve();
}
