import type { Message } from "@snezhok/contracts";

/**
 * Merges server history, realtime events and local optimistic messages.
 * A server message has a different database id than its optimistic placeholder,
 * so the sender-generated clientId is the durable reconciliation key.
 */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const merged: Message[] = [];
  for (const message of [...existing, ...incoming]) {
    const clientId = message.clientId ?? (message.pending || message.failed ? message.id : null);
    const index = merged.findIndex((candidate) =>
      candidate.id === message.id || Boolean(clientId && (candidate.clientId === clientId || ((candidate.pending || candidate.failed) && candidate.id === clientId))),
    );
    if (index >= 0) merged[index] = message;
    else merged.push(message);
  }
  return merged.sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt);
}

export function markMessageDeleted(existing: Message[], id: string, deletedAt: number): Message[] {
  return existing.map((message) => message.id === id
    ? { ...message, text: "", deletedAt, editedAt: null, pinnedAt: null }
    : message);
}

/** Tombstones stay cached for realtime ordering but are not rendered. */
export function visibleMessages(messages: Message[]): Message[] {
  return messages.filter((message) => message.deletedAt === null);
}

export function reconcilePinnedMessages(existing: Message[], pinned: Message[]): Message[] {
  const pinnedIds = new Set(pinned.map((message) => message.id));
  const canonicalized = existing.map((message) => message.pinnedAt && !pinnedIds.has(message.id) ? { ...message, pinnedAt: null } : message);
  return mergeMessages(canonicalized, pinned);
}
