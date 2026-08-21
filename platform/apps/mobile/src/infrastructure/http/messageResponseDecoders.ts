import {
  messageContextSchema,
  messageEnvelopeSchema,
  messagePageSchema,
  messagesEnvelopeSchema,
  type Message,
} from "@snezhok/contracts";

import { decodeMessageList, decodeMessageValue } from "../../domains/messaging/messageDecoding";

type MessagePage = { items: Message[]; nextCursor: string | null };
type MessagesEnvelope = { messages: Message[] };
type MessageContext = { streamId: string; targetId: string; items: Message[] };

/**
 * The server envelope is still validated strictly, while individual message
 * records are decoded independently. A legacy attachment may therefore be
 * repaired without turning an entire history page into an empty chat.
 */
export const resilientMessagePageDecoder = {
  parse(input: unknown): MessagePage {
    const source = record(input);
    const envelope = messagePageSchema.parse({ ...source, items: [] });
    return { ...envelope, items: decodeMessageList(source.items, 100).messages };
  },
};

export const resilientMessagesEnvelopeDecoder = {
  parse(input: unknown): MessagesEnvelope {
    const source = record(input);
    messagesEnvelopeSchema.parse({ ...source, messages: [] });
    return { messages: decodeMessageList(source.messages, 1_000).messages };
  },
};

export const resilientMessageContextDecoder = {
  parse(input: unknown): MessageContext {
    const source = record(input);
    const envelope = messageContextSchema.parse({ ...source, items: [] });
    return { ...envelope, items: decodeMessageList(source.items, 100).messages };
  },
};

export const resilientMessageEnvelopeDecoder = {
  parse(input: unknown): { message: Message } {
    const source = record(input);
    const decoded = decodeMessageValue(source.message);
    if (!decoded.message) return messageEnvelopeSchema.parse(input) as { message: Message };
    return { message: decoded.message };
  },
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a response object");
  return value as Record<string, unknown>;
}
