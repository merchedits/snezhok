import type { Message } from "@snezhok/contracts";

import type { CachedState } from "../types";
import { messagesForCache, normalizeCachedMessages } from "./cachePolicy";

export const RECENT_MESSAGES_PER_STREAM = 80;
export const DEFAULT_CACHE_PAGE_SIZE = 40;
export const MAX_CACHE_PAGE_SIZE = 100;

export interface CachedMessageRow {
  stream_id: string;
  payload: string;
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
