import type { Attachment, Message, ReactionSummary } from "@snezhok/contracts";

const attachmentKinds = new Set<Attachment["kind"]>(["image", "video", "audio", "document"]);

/**
 * Message payloads can outlive the client that cached them and can arrive from
 * an optimistic/native transfer before the canonical HTTP response. Never let
 * one damaged nested record reach FlashList or a native media component.
 */
export function renderableAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  const result: Attachment[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (!isRenderableAttachment(item) || ids.has(item.id)) continue;
    ids.add(item.id);
    result.push(item);
  }
  return result;
}

export function renderableReactions(value: unknown): ReactionSummary[] {
  if (!Array.isArray(value)) return [];
  const result: ReactionSummary[] = [];
  const emojis = new Set<string>();
  for (const item of value) {
    if (!isRenderableReaction(item) || emojis.has(item.emoji)) continue;
    emojis.add(item.emoji);
    result.push(item);
  }
  return result;
}

/** Retains object identity for healthy messages so memoized rows stay cheap. */
export function normalizeMessagePayload(message: Message): Message {
  const attachments = renderableAttachments(message.attachments);
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

function isRenderableAttachment(value: unknown): value is Attachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Partial<Attachment>;
  return typeof attachment.id === "string"
    && attachment.id.length > 0
    && typeof attachment.kind === "string"
    && attachmentKinds.has(attachment.kind as Attachment["kind"])
    && typeof attachment.url === "string"
    && attachment.url.length > 0;
}

function isRenderableReaction(value: unknown): value is ReactionSummary {
  if (!value || typeof value !== "object") return false;
  const reaction = value as Partial<ReactionSummary>;
  return typeof reaction.emoji === "string"
    && reaction.emoji.length > 0
    && typeof reaction.count === "number"
    && Number.isFinite(reaction.count)
    && typeof reaction.reacted === "boolean"
    && Array.isArray(reaction.userIds);
}
