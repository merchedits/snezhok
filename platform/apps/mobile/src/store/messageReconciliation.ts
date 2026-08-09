import type { Message } from "@snezhok/contracts";

import { normalizeMessagePayload } from "../lib/messagePayload";

/**
 * Merges server history, realtime events and local optimistic messages.
 * A server message has a different database id than its optimistic placeholder,
 * so the sender-generated clientId is the durable reconciliation key.
 */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const merged: Message[] = [];
  const byId = new Map<string, number>();
  const byClientId = new Map<string, number>();

  const append = (rawMessage: Message) => {
    const message = normalizeMessagePayload(rawMessage);
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
      return;
    }
    const nextIndex = merged.length;
    merged.push(message);
    byId.set(message.id, nextIndex);
    if (clientId) byClientId.set(clientId, nextIndex);
  };
  for (const message of existing) append(message);
  for (const message of incoming) append(message);

  // Latest HTTP/realtime messages are already ordered almost all of the time.
  // Skip O(n log n) sorting on that common path while retaining deterministic
  // ordering for history pages and context loads.
  for (let index = 1; index < merged.length; index += 1) {
    if (compareMessages(merged[index - 1]!, merged[index]!) > 0) return merged.sort(compareMessages);
  }
  return merged;
}

function compareMessages(left: Message, right: Message): number {
  return left.sequence - right.sequence || left.createdAt - right.createdAt;
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
