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
