export interface ChatTimelineMemory {
  anchorMessageId: string | null;
  renderLimit: number;
  atBottom: boolean;
  rememberedAt: number;
}

const MAX_REMEMBERED_CHATS = 48;
const MEMORY_TTL_MS = 2 * 60 * 60_000;
const positions = new Map<string, ChatTimelineMemory>();

export function readChatTimelineMemory(streamId: string, now = Date.now()): ChatTimelineMemory | null {
  const remembered = positions.get(streamId);
  if (!remembered) return null;
  if (now - remembered.rememberedAt > MEMORY_TTL_MS) {
    positions.delete(streamId);
    return null;
  }
  return remembered;
}

export function rememberChatTimelinePosition(
  streamId: string,
  position: Omit<ChatTimelineMemory, "rememberedAt">,
  now = Date.now(),
): void {
  positions.delete(streamId);
  positions.set(streamId, { ...position, rememberedAt: now });
  while (positions.size > MAX_REMEMBERED_CHATS) {
    const oldest = positions.keys().next().value;
    if (typeof oldest !== "string") break;
    positions.delete(oldest);
  }
}

export function initialChatTimelineIndex(
  messageIds: readonly string[],
  remembered: ChatTimelineMemory | null,
): number | undefined {
  if (!messageIds.length) return undefined;
  if (!remembered || remembered.atBottom || !remembered.anchorMessageId) return messageIds.length - 1;
  const rememberedIndex = messageIds.indexOf(remembered.anchorMessageId);
  return rememberedIndex >= 0 ? rememberedIndex : messageIds.length - 1;
}

export function resetChatTimelineMemoryForTests(): void {
  positions.clear();
}
