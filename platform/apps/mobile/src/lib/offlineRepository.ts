import AsyncStorage from "@react-native-async-storage/async-storage";

import type { CachedState, OutboxEntry } from "../types";
import { normalizeCachedMessages } from "./cachePolicy";

const CACHE_KEY = "@snezhok/cache/v2";
const LEGACY_CACHE_KEY = "@snezhok/cache/v1";
const OUTBOX_KEY = "@snezhok/outbox/v1";

const EMPTY_CACHE: CachedState = { bootstrap: null, messages: {}, cachedAt: 0 };

export async function readCache(): Promise<CachedState> {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return migrateLegacyCache();
  return parseCache(raw);
}

function parseCache(raw: string): CachedState {
  if (!raw) return EMPTY_CACHE;
  try {
    const parsed = JSON.parse(raw) as CachedState;
    if (!parsed.messages || typeof parsed.messages !== "object" || typeof parsed.cachedAt !== "number") return EMPTY_CACHE;
    const messages = normalizeCachedMessages(parsed.messages);
    return { ...parsed, messages };
  } catch {
    return EMPTY_CACHE;
  }
}

async function migrateLegacyCache(): Promise<CachedState> {
  const raw = await AsyncStorage.getItem(LEGACY_CACHE_KEY);
  if (!raw) return EMPTY_CACHE;
  try {
    const parsed = JSON.parse(raw) as Partial<CachedState>;
    const migrated: CachedState = { bootstrap: parsed.bootstrap ?? null, messages: {}, cachedAt: typeof parsed.cachedAt === "number" ? parsed.cachedAt : 0 };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(migrated));
    await AsyncStorage.removeItem(LEGACY_CACHE_KEY);
    return migrated;
  } catch {
    await AsyncStorage.removeItem(LEGACY_CACHE_KEY);
    return EMPTY_CACHE;
  }
}

export async function writeCache(cache: CachedState): Promise<void> {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as OutboxEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeOutbox(entries: OutboxEntry[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
}

export async function clearLocalData(): Promise<void> {
  await Promise.all([AsyncStorage.removeItem(CACHE_KEY), AsyncStorage.removeItem(LEGACY_CACHE_KEY), AsyncStorage.removeItem(OUTBOX_KEY)]);
}
