import type { Message } from "@snezhok/contracts";

/**
 * Merges server history, realtime events and local optimistic messages.
 * A server message has a different database id than its optimistic placeholder,
 * so the sender-generated clientId is the durable reconciliation key.
 */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const merged: Message[] = [];
  const byId = new Map<string, number>();
  const byClientId = new Map<string, number>();

  for (const message of [...existing, ...incoming]) {
    const clientId = message.clientId ?? (message.pending || message.failed ? message.id : null);
    const index = byId.get(message.id) ?? (clientId ? byClientId.get(clientId) : undefined);
    if (index !== undefined) {
      const previous = merged[index]!;
      const previousClientId = previous.clientId ?? (previous.pending || previous.failed ? previous.id : null);
      if (previous.id !== message.id) byId.delete(previous.id);
      if (previousClientId && previousClientId !== clientId) byClientId.delete(previousClientId);
      const next = reconcileMessageVersion(previous, message);
      merged[index] = next;
      byId.set(next.id, index);
      if (clientId) byClientId.set(clientId, index);
      continue;
    }
    const nextIndex = merged.length;
    merged.push(message);
    byId.set(message.id, nextIndex);
    if (clientId) byClientId.set(clientId, nextIndex);
  }
  return merged.sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt);
}

/** A delayed HTTP/update response must never resurrect a durable deletion. */
export function reconcileMessageVersion(previous: Message, incoming: Message): Message {
  if (previous.id === incoming.id && previous.deletedAt !== null && !previous.pending && incoming.deletedAt === null) {
    return incoming.readByOthers ? { ...previous, readByOthers: true } : previous;
  }
  return incoming;
}

export function markMessageDeleted(existing: Message[], id: string, deletedAt: number, pending = false): Message[] {
  return existing.map((message) => {
    if (message.id !== id) return message;
    const { pending: _pending, failed: _failed, ...stable } = message;
    return { ...stable, text: "", deletedAt, editedAt: null, pinnedAt: null, ...(pending ? { pending: true } : {}) };
  });
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
