import type { ConversationSummary, UserSummary } from "@snezhok/contracts";

/** A direct-conversation identity is the account id, never its mutable name. */
export function directPeer(conversation: ConversationSummary, currentUserId: string | undefined): UserSummary | undefined {
  if (conversation.kind !== "direct" || conversation.saved) return undefined;
  return conversation.participants.find((participant) => participant.id !== currentUserId)
    ?? conversation.participants[0];
}

/** Saved and pinned rows form one uninterrupted block, like Telegram. */
export function startsRegularConversationSection(items: ConversationSummary[], index: number): boolean {
  if (index <= 0) return false;
  const previous = items[index - 1];
  const current = items[index];
  if (!previous || !current) return false;
  return (previous.saved || previous.pinned) && !current.saved && !current.pinned;
}

export function upsertConversation(items: ConversationSummary[], incoming: ConversationSummary): ConversationSummary[] {
  return items.some((item) => item.id === incoming.id)
    ? items.map((item) => item.id === incoming.id ? incoming : item)
    : [incoming, ...items];
}
