import type { OutboxEntry } from "../types";

export function outboxKind(entry: OutboxEntry): NonNullable<OutboxEntry["kind"]> {
  return entry.kind;
}

/**
 * Coalesces last-write-wins mutations without reordering independent sends.
 * This keeps a long offline session bounded while preserving stream ordering.
 */
export function enqueueOutbox(entries: OutboxEntry[], incoming: OutboxEntry): OutboxEntry[] {
  incoming = attachDependencies(entries, incoming);
  if (incoming.kind === "message" || incoming.kind === "forward") {
    return entries.some((entry) => entry.id === incoming.id) ? entries : [...entries, incoming];
  }

  if (incoming.kind === "delete") {
    const previous = entries.find((entry) => targetsMessage(entry, incoming.messageId) && "previous" in entry);
    return [
      ...entries.filter((entry) => !targetsMessage(entry, incoming.messageId)),
      previous && "previous" in previous ? { ...incoming, previous: previous.previous } : incoming,
    ];
  }

  if (incoming.kind === "read") {
    const previous = entries.find((entry) => entry.kind === "read" && entry.streamId === incoming.streamId);
    const monotonic = previous?.kind === "read" && previous.sequence > incoming.sequence ? { ...incoming, sequence: previous.sequence } : incoming;
    return [...entries.filter((entry) => mutationKey(entry) !== mutationKey(incoming)), monotonic];
  }

  const key = mutationKey(incoming);
  const previous = entries.find((entry) => mutationKey(entry) === key && "previous" in entry);
  const compacted = entries.filter((entry) => mutationKey(entry) !== key);
  return [...compacted, previous && "previous" in previous && "previous" in incoming ? { ...incoming, previous: previous.previous } : incoming];
}

/** Resolves optimistic client IDs after an earlier queued send is acknowledged. */
export function resolveOutboxMessageId(messageId: string, acknowledgedIds: ReadonlyMap<string, string>): string {
  return acknowledgedIds.get(messageId) ?? messageId;
}

export async function replayOutbox(
  entries: OutboxEntry[],
  dispatch: (entry: OutboxEntry) => Promise<void>,
  onSuccess: (entry: OutboxEntry) => void,
  onFailure: (entry: OutboxEntry, error: unknown) => void,
): Promise<void> {
  await drainOutbox(entries, dispatch, onSuccess, onFailure, { concurrency: 1, now: Number.MAX_SAFE_INTEGER });
}

export interface OutboxDrainOptions {
  concurrency?: number;
  now?: number;
}

export interface OutboxDrainResult {
  dispatched: number;
  nextAvailableAt: number | null;
}

/**
 * Preserves order within a chat, runs independent chats concurrently, and
 * holds cross-stream dependants until their idempotent prerequisite commits.
 */
export async function drainOutbox(
  entries: readonly OutboxEntry[],
  dispatch: (entry: OutboxEntry) => Promise<void>,
  onSuccess: (entry: OutboxEntry) => void,
  onFailure: (entry: OutboxEntry, error: unknown) => void,
  options: OutboxDrainOptions = {},
): Promise<OutboxDrainResult> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6));
  const now = options.now ?? Date.now();
  const queues = new Map<string, OutboxEntry[]>();
  const remaining = new Set(entries.map((entry) => entry.id));
  for (const entry of entries) {
    const queue = queues.get(entry.streamId) ?? [];
    queue.push(entry);
    queues.set(entry.streamId, queue);
  }
  const blockedStreams = new Set<string>();
  let dispatched = 0;

  while (true) {
    const ready = [...queues.entries()].flatMap(([streamId, queue]) => {
      const entry = queue[0];
      if (!entry || blockedStreams.has(streamId) || (entry.availableAt ?? 0) > now) return [];
      return (entry.dependsOn ?? []).some((dependency) => remaining.has(dependency)) ? [] : [entry];
    }).slice(0, concurrency);
    if (!ready.length) break;
    const results = await Promise.all(ready.map(async (entry) => {
      try { await dispatch(entry); return { entry, error: null as unknown }; }
      catch (error) { return { entry, error }; }
    }));
    for (const { entry, error } of results) {
      if (error) {
        blockedStreams.add(entry.streamId);
        onFailure(entry, error);
        continue;
      }
      queues.get(entry.streamId)?.shift();
      remaining.delete(entry.id);
      dispatched += 1;
      onSuccess(entry);
    }
  }
  const nextAvailableAt = [...queues.entries()]
    .filter(([streamId, queue]) => !blockedStreams.has(streamId) && queue.length > 0)
    .map(([, queue]) => queue[0]!.availableAt ?? 0)
    .filter((availableAt) => availableAt > now)
    .sort((left, right) => left - right)[0] ?? null;
  return { dispatched, nextAvailableAt };
}

export function retryAvailableAt(attempts: number, now = Date.now(), random = Math.random): number {
  const ceiling = Math.min(60_000, 1_000 * (2 ** Math.min(Math.max(0, attempts), 6)));
  return now + Math.max(250, Math.round(ceiling * (0.5 + random() * 0.5)));
}

export class MutationRetryScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scheduledAt: number | null = null;

  schedule(availableAt: number, run: () => void, now = Date.now()): void {
    if (this.scheduledAt !== null && this.scheduledAt <= availableAt) return;
    this.cancel();
    this.scheduledAt = availableAt;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scheduledAt = null;
      run();
    }, Math.max(0, availableAt - now));
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.scheduledAt = null;
  }
}

function mutationKey(entry: OutboxEntry): string {
  if (entry.kind === "read") return `read:${entry.streamId}`;
  if (entry.kind === "edit") return `edit:${entry.messageId}`;
  if (entry.kind === "pin") return `pin:${entry.messageId}`;
  if (entry.kind === "reaction") return `reaction:${entry.messageId}:${entry.emoji}`;
  if (entry.kind === "delete") return `delete:${entry.messageId}`;
  return `${entry.kind}:${entry.id}`;
}

function targetsMessage(entry: OutboxEntry, messageId: string): boolean {
  return (entry.kind === "edit" || entry.kind === "pin" || entry.kind === "reaction" || entry.kind === "delete") && entry.messageId === messageId;
}

function attachDependencies(entries: OutboxEntry[], incoming: OutboxEntry): OutboxEntry {
  if (incoming.dependsOn?.length) return incoming;
  const targetId = incoming.kind === "forward" ? incoming.sourceMessageId
    : incoming.kind === "edit" || incoming.kind === "pin" || incoming.kind === "reaction" || incoming.kind === "delete" ? incoming.messageId
      : null;
  if (!targetId) return incoming;
  const dependency = entries.find((entry) => (entry.kind === "message" && (entry.id === targetId || entry.input.clientId === targetId))
    || (entry.kind === "forward" && (entry.id === targetId || entry.clientId === targetId)));
  return dependency ? { ...incoming, dependsOn: [dependency.id] } : incoming;
}
