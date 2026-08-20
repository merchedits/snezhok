import type { Message } from "@snezhok/contracts";

import type { OutboxEntry } from "../../types";

export interface OutboxTransport {
  createMessage: (streamId: string, input: Extract<OutboxEntry, { kind?: "message" }>["input"]) => Promise<Message>;
  forwardMessage: (messageId: string, streamId: string, clientId: string) => Promise<Message>;
  markRead: (streamId: string, sequence: number) => Promise<unknown>;
  editMessage: (messageId: string, text: string) => Promise<Message>;
  hideMessage: (messageId: string) => Promise<unknown>;
  deleteMessage: (messageId: string) => Promise<Message>;
  setMessagePinned: (messageId: string, pinned: boolean) => Promise<Message>;
  setReaction: (messageId: string, emoji: string, active: boolean) => Promise<Message>;
}

export type OutboxDispatchResult =
  | { kind: "created"; entryId: string; clientId: string; message: Message }
  | { kind: "read"; streamId: string }
  | { kind: "edited"; streamId: string; messageId: string; expectedText: string; message: Message }
  | { kind: "hidden"; streamId: string; messageId: string }
  | { kind: "deleted"; streamId: string; message: Message }
  | { kind: "pinned"; streamId: string; messageId: string; expectedPinned: boolean; message: Message }
  | { kind: "reacted"; streamId: string; messageId: string; emoji: string; expectedActive: boolean; message: Message };

/** Network-only application use case. Projection commits remain deterministic. */
export async function dispatchOutboxEntry(
  transport: OutboxTransport,
  entry: OutboxEntry,
  acknowledgedIds: ReadonlyMap<string, string>,
): Promise<OutboxDispatchResult> {
  if (entry.kind === "message") {
    const message = await transport.createMessage(entry.streamId, entry.input);
    return { kind: "created", entryId: entry.id, clientId: entry.input.clientId, message };
  }
  if (entry.kind === "forward") {
    const message = await transport.forwardMessage(resolveMessageId(entry.sourceMessageId, acknowledgedIds), entry.streamId, entry.clientId);
    return { kind: "created", entryId: entry.id, clientId: entry.clientId, message };
  }
  if (entry.kind === "read") {
    await transport.markRead(entry.streamId, entry.sequence);
    return { kind: "read", streamId: entry.streamId };
  }

  const messageId = resolveMessageId(entry.messageId, acknowledgedIds);
  if (entry.kind === "edit") {
    const message = await transport.editMessage(messageId, entry.text);
    return { kind: "edited", streamId: entry.streamId, messageId, expectedText: entry.text, message };
  }
  if (entry.kind === "delete") {
    if (entry.scope === "me") {
      await transport.hideMessage(messageId);
      return { kind: "hidden", streamId: entry.streamId, messageId };
    }
    const message = await transport.deleteMessage(messageId);
    return { kind: "deleted", streamId: entry.streamId, message };
  }
  if (entry.kind === "pin") {
    const message = await transport.setMessagePinned(messageId, entry.pinned);
    return { kind: "pinned", streamId: entry.streamId, messageId, expectedPinned: entry.pinned, message };
  }
  const message = await transport.setReaction(messageId, entry.emoji, entry.active);
  return { kind: "reacted", streamId: entry.streamId, messageId, emoji: entry.emoji, expectedActive: entry.active, message };
}

function resolveMessageId(messageId: string, acknowledgedIds: ReadonlyMap<string, string>): string {
  return acknowledgedIds.get(messageId) ?? messageId;
}
