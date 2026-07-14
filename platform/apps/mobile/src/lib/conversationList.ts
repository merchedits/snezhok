import type { ConversationSummary } from "@snezhok/contracts";

export function visibleConversationSummaries(
  conversations: ConversationSummary[],
  search: string,
  titleFor: (conversation: ConversationSummary) => string,
): ConversationSummary[] {
  const query = search.trim().toLocaleLowerCase();
  return conversations
    .filter((conversation) => {
      if (conversation.archived) return false;
      if (!query) return true;
      return titleFor(conversation).toLocaleLowerCase().includes(query)
        || Boolean(conversation.lastMessage?.text.toLocaleLowerCase().includes(query));
    })
    .sort((a, b) => Number(b.saved) - Number(a.saved)
      || Number(b.pinned) - Number(a.pinned)
      || b.updatedAt - a.updatedAt);
}
