import type { Message } from "@snezhok/contracts";

export function normalizeCachedMessages(value: unknown): Record<string, Message[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([streamId, items]) => [streamId, Array.isArray(items) ? items.filter(isSafeCachedMessage).map((message) => ({ ...message, attachments: Array.isArray(message.attachments) ? message.attachments : [], reactions: Array.isArray(message.reactions) ? message.reactions : [] })) : []]));
}

/**
 * Keep offline startup useful without serializing the entire account history on
 * every realtime event. Pending work and pinned messages survive outside the
 * rolling window so an interrupted send is never discarded.
 */
export function messagesForCache(messages: Record<string, Message[]>, recentLimit = 80): Record<string, Message[]> {
  return Object.fromEntries(Object.entries(messages).map(([streamId, items]) => {
    if (items.length <= recentLimit) return [streamId, items];
    const keep = new Set(items.slice(-recentLimit).map((message) => message.id));
    for (const message of items) {
      if (message.pending || message.failed || message.pinnedAt != null) keep.add(message.id);
    }
    return [streamId, items.filter((message) => keep.has(message.id))];
  }));
}

export type MessageWindowEdge = "latest" | "older";

/**
 * Bound live JS memory without discarding messages that represent unfinished
 * work or durable pins. Older-page loads keep their historical edge visible;
 * latest/realtime loads keep the newest edge visible.
 */
export function boundedMessageWindow(messages: Message[], limit = 300, edge: MessageWindowEdge = "latest"): Message[] {
  if (messages.length <= limit) return messages;
  const window = edge === "latest" ? messages.slice(-limit) : messages.slice(0, limit);
  const keep = new Set(window.map((message) => message.id));
  for (const message of messages) {
    if (message.pending || message.failed || message.pinnedAt != null) keep.add(message.id);
  }
  return messages.filter((message) => keep.has(message.id));
}

function isSafeCachedMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as { id?: unknown; streamId?: unknown; sequence?: unknown; createdAt?: unknown; sender?: { id?: unknown } };
  return typeof message.id === "string" && typeof message.streamId === "string" && typeof message.sequence === "number" && typeof message.createdAt === "number" && typeof message.sender?.id === "string";
}
