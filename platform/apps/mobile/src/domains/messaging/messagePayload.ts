import { reactionSummarySchema, type Attachment, type Message, type ReactionSummary } from "@snezhok/contracts";

import { decodeAttachmentValue } from "./messageDecoding";

/**
 * Message payloads can outlive the client that cached them and can arrive from
 * an optimistic/native transfer before the canonical HTTP response. Never let
 * one damaged nested record reach FlashList or a native media component.
 */
export function renderableAttachments(value: unknown, fallbackOwnerId: string | null = null): Attachment[] {
  if (!Array.isArray(value)) return [];
  const result: Attachment[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const attachment = decodeAttachmentValue(item, fallbackOwnerId);
    if (!attachment || ids.has(attachment.id)) continue;
    ids.add(attachment.id);
    result.push(attachment);
  }
  return result;
}

export function renderableReactions(value: unknown): ReactionSummary[] {
  if (!Array.isArray(value)) return [];
  const result: ReactionSummary[] = [];
  const emojis = new Set<string>();
  for (const item of value) {
    const reaction = reactionSummarySchema.safeParse(item);
    if (!reaction.success || emojis.has(reaction.data.emoji)) continue;
    emojis.add(reaction.data.emoji);
    result.push(reaction.data);
  }
  return result;
}

/** Retains object identity for healthy messages so memoized rows stay cheap. */
export function normalizeMessagePayload(message: Message): Message {
  const attachments = renderableAttachments(message.attachments, message.sender.id);
  const reactions = renderableReactions(message.reactions);
  const attachmentsUnchanged = Array.isArray(message.attachments)
    && attachments.length === message.attachments.length
    && attachments.every((attachment, index) => attachment === message.attachments[index]);
  const reactionsUnchanged = Array.isArray(message.reactions)
    && reactions.length === message.reactions.length
    && reactions.every((reaction, index) => reaction === message.reactions[index]);
  if (attachmentsUnchanged && reactionsUnchanged) return message;
  return { ...message, attachments, reactions };
}
