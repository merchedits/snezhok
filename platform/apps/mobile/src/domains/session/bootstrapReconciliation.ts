import type { ConversationSummary, Message } from "@snezhok/contracts";

export interface BootstrapReconciliationState {
  outbox: ReadonlyArray<{ kind: string; streamId: string }>;
  conversations: readonly ConversationSummary[];
  messages: Readonly<Record<string, readonly Message[]>>;
}

/** Preserves durable optimistic previews and read acknowledgements across snapshot refreshes. */
export function reconcileBootstrapConversations(state: BootstrapReconciliationState, incoming: ConversationSummary[]): ConversationSummary[] {
  const pendingReadStreams = new Set(state.outbox.filter((entry) => entry.kind === "read").map((entry) => entry.streamId));
  const localById = new Map(state.conversations.map((conversation) => [conversation.id, conversation]));
  return incoming.map((conversation) => {
    const local = localById.get(conversation.id);
    const optimisticPreview = local?.lastMessage && (state.messages[conversation.id] ?? []).some((message) =>
      (message.pending || message.failed) && (message.id === local.lastMessage?.id || message.clientId === local.lastMessage?.id));
    return {
      ...conversation,
      ...(optimisticPreview ? { lastMessage: local.lastMessage, updatedAt: Math.max(conversation.updatedAt, local.updatedAt) } : {}),
      ...(pendingReadStreams.has(conversation.id) ? { unreadCount: 0, mentionCount: 0 } : {}),
    };
  });
}
