import type { OutboxEntry } from "../types";

export function outboxKind(entry: OutboxEntry): NonNullable<OutboxEntry["kind"]> {
  return entry.kind;
}

/**
 * Coalesces last-write-wins mutations without reordering independent sends.
 * This keeps a long offline session bounded while preserving stream ordering.
 */
export function enqueueOutbox(entries: OutboxEntry[], incoming: OutboxEntry): OutboxEntry[] {
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
  const blockedStreams = new Set<string>();
  for (const entry of entries) {
    if (blockedStreams.has(entry.streamId)) continue;
    try {
      await dispatch(entry);
      onSuccess(entry);
    } catch (error) {
      blockedStreams.add(entry.streamId);
      onFailure(entry, error);
    }
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
