import type { Message } from "@snezhok/contracts";

import type { CachedState } from "../types";
import { messagesForCache, normalizeCachedMessages } from "../domains/messaging/cachePolicy";

export const RECENT_MESSAGES_PER_STREAM = 80;
export const DEFAULT_CACHE_PAGE_SIZE = 40;
export const MAX_CACHE_PAGE_SIZE = 100;
export const STARTUP_STREAM_LIMIT = 16;

export interface CachedMessageRow {
  stream_id: string;
  payload: string;
}

export interface CachedStoredProjectionRow {
  message_id: string;
  payload: string;
  important: number;
}

export function importantCachedMessage(message: Message): boolean {
  return Boolean(message.pending || message.failed || message.pinnedAt != null);
}

/** Old pinned/outbox islands must not move the contiguous history cursor. */
export function cachedHistoryCursor(messages: Message[]): number | undefined {
  return messages.find((message) => !importantCachedMessage(message))?.sequence ?? messages[0]?.sequence;
}

export function cachedStreamDelta(existingRows: CachedStoredProjectionRow[], input: Message[]): {
  upserts: Array<{ message: Message; payload: string; important: number }>;
  removedIds: string[];
} {
  const desired = messagesForCache({ stream: input }, RECENT_MESSAGES_PER_STREAM).stream ?? [];
  const existing = new Map(existingRows.map((row) => [row.message_id, row]));
  const desiredIds = new Set<string>();
  const desiredClientIds = new Set<string>();
  const upserts: Array<{ message: Message; payload: string; important: number }> = [];
  for (const message of desired) {
    desiredIds.add(message.id);
    if (message.clientId) desiredClientIds.add(message.clientId);
    const payload = JSON.stringify(message);
    const important = importantCachedMessage(message) ? 1 : 0;
    const previous = existing.get(message.id);
    if (previous?.payload !== payload || previous.important !== important) upserts.push({ message, payload, important });
  }
  return {
    upserts,
    // A partial in-memory window must never erase valid cached history. Only
    // remove a missing row when a canonical server message proves that it is
    // the optimistic predecessor with the same client identity.
    removedIds: existingRows.filter((row) => {
      if (desiredIds.has(row.message_id)) return false;
      try {
        const previous = JSON.parse(row.payload) as Message;
        const previousClientId = previous.clientId ?? (previous.pending || previous.failed ? previous.id : null);
        return desiredClientIds.has(previous.id) || Boolean(previousClientId && desiredClientIds.has(previousClientId));
      } catch {
        return false;
      }
    }).map((row) => row.message_id),
  };
}

/** Pick a bounded useful startup working set instead of decoding every chat. */
export function startupStreamIds(bootstrap: CachedState["bootstrap"], limit = STARTUP_STREAM_LIMIT): string[] {
  if (!bootstrap || limit <= 0) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (result.length >= limit || seen.has(id)) return;
    seen.add(id);
    result.push(id);
  };
  for (const conversation of bootstrap.conversations) {
    if (conversation.saved || conversation.pinned || conversation.unreadCount > 0) add(conversation.id);
  }
  for (const channel of bootstrap.channels) {
    if (channel.unreadCount > 0) add(channel.id);
  }
  for (const conversation of bootstrap.conversations) add(conversation.id);
  for (const channel of bootstrap.channels) add(channel.id);
  return result;
}

export function boundedCachedState(cache: CachedState): CachedState {
  return {
    bootstrap: cache.bootstrap ?? null,
    messages: messagesForCache(normalizeCachedMessages(cache.messages), RECENT_MESSAGES_PER_STREAM),
    cachedAt: Number.isFinite(cache.cachedAt) ? cache.cachedAt : 0,
  };
}

/** Safely decode the AsyncStorage v2 snapshot without touching auth/session data. */
export function parseLegacyCache(raw: string | null): CachedState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CachedState>;
    if (!parsed || typeof parsed !== "object") return null;
    return boundedCachedState({
      bootstrap: parsed.bootstrap ?? null,
      messages: normalizeCachedMessages(parsed.messages),
      cachedAt: typeof parsed.cachedAt === "number" ? parsed.cachedAt : 0,
    });
  } catch {
    return null;
  }
}

export function decodeMessageRows(rows: CachedMessageRow[]): Record<string, Message[]> {
  const grouped: Record<string, unknown[]> = {};
  for (const row of rows) {
    try {
      (grouped[row.stream_id] ??= []).push(JSON.parse(row.payload));
    } catch {
      // A damaged row must not prevent the rest of the offline cache loading.
    }
  }
  return normalizeCachedMessages(grouped);
}

export function clampCachePageSize(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_CACHE_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_CACHE_PAGE_SIZE, Math.floor(limit!)));
}

/** Pure equivalent of the SQLite cursor query, used to lock down paging semantics. */
export function cachedMessagePage(messages: Message[], before?: number, limit?: number): Message[] {
  const pageSize = clampCachePageSize(limit);
  return messages
    .filter((message) => before === undefined || message.sequence < before)
    .sort((left, right) => right.sequence - left.sequence)
    .slice(0, pageSize)
    .reverse();
}
