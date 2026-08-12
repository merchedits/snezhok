import type { Message } from "@snezhok/contracts";

export type ChatOpenPerformanceKind = "warmChatOpen" | "cachedChatOpen";

/**
 * A stream already present in Zustand is a warm open. An empty in-memory
 * projection may still be restored from SQLite during the native transition,
 * which is the slower cached-open budget.
 */
export function chatOpenPerformanceKind(messageCountAtNavigation: number): ChatOpenPerformanceKind {
  return messageCountAtNavigation > 0 ? "warmChatOpen" : "cachedChatOpen";
}

export function uncachedWarmStreamIds(
  streamIds: readonly string[],
  messagesByStream: Readonly<Record<string, readonly Message[]>>,
  limit = 12,
): string[] {
  if (limit <= 0) return [];
  return [...new Set(streamIds)].filter((streamId) => !(messagesByStream[streamId]?.length)).slice(0, limit);
}

/** Selects only small previews that can make the first visible chat frame warm. */
export function recentMediaPreviewUris(
  messagesByStream: Record<string, Message[]>,
  streamIds: readonly string[],
  limit = 24,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const streamId of streamIds) {
    const messages = messagesByStream[streamId] ?? [];
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const attachments = messages[messageIndex]!.attachments ?? [];
      for (let attachmentIndex = attachments.length - 1; attachmentIndex >= 0; attachmentIndex -= 1) {
        const attachment = attachments[attachmentIndex]!;
        if (attachment.kind !== "image" && attachment.kind !== "video") continue;
        const uri = attachment.thumbnailUrl ?? (attachment.kind === "image" ? attachment.url : null);
        if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        result.push(uri);
        if (result.length >= limit) return result;
      }
    }
  }
  return result;
}
