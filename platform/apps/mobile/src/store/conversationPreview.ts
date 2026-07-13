import type { ConversationSummary, Message, MessagePreview } from "@snezhok/contracts";

export function messagePreview(message: Message): MessagePreview {
  return {
    id: message.id,
    senderId: message.sender.id,
    senderName: message.sender.displayName || message.sender.username,
    text: message.deletedAt ? "" : message.text,
    kind: message.kind,
    createdAt: message.createdAt,
  };
}

/**
 * Keeps the lightweight chat-list model in sync with message history. This is
 * intentionally applied to optimistic messages too, so the list never lags
 * behind the chat the user just sent from.
 */
export function applyConversationPreview(conversations: ConversationSummary[], message: Message): ConversationSummary[] {
  if (message.streamKind !== "conversation") return conversations;

  let changed = false;
  const next = conversations.map((conversation) => {
    if (conversation.id !== message.streamId) return conversation;
    const current = conversation.lastMessage;
    const replacesOptimistic = Boolean(message.clientId && current?.id === message.clientId);
    const updatesCurrent = current?.id === message.id || replacesOptimistic;
    if (current && !updatesCurrent && current.createdAt > message.createdAt) return conversation;

    changed = true;
    return {
      ...conversation,
      lastMessage: messagePreview(message),
      updatedAt: Math.max(conversation.updatedAt, message.createdAt),
    };
  });
  return changed ? next : conversations;
}
