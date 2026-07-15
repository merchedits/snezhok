import AsyncStorage from "@react-native-async-storage/async-storage";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import type { Message } from "@snezhok/contracts";

import type { CachedState, OutboxEntry } from "../types";
import {
  boundedCachedState,
  clampCachePageSize,
  decodeMessageRows,
  parseLegacyCache,
  type CachedMessageRow,
} from "./offlineCachePolicy";

const DATABASE_NAME = "snezhok-offline.db";
const CACHE_KEY = "@snezhok/cache/v2";
const LEGACY_CACHE_KEY = "@snezhok/cache/v1";
const OUTBOX_KEY = "@snezhok/outbox/v1";
const DRAFTS_KEY = "@snezhok/drafts/v1";
const MIGRATION_KEY = "async_storage_v2_migrated";

const EMPTY_CACHE: CachedState = { bootstrap: null, messages: {}, cachedAt: 0 };

let databasePromise: Promise<SQLiteDatabase> | null = null;

function database(): Promise<SQLiteDatabase> {
  databasePromise ??= openDatabaseAsync(DATABASE_NAME).then(async (db) => {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS cache_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cached_messages (
        stream_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        write_generation INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (stream_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS cached_messages_stream_sequence
        ON cached_messages (stream_id, sequence DESC);
      PRAGMA user_version = 1;
    `);
    await migrateAsyncStorageCache(db);
    return db;
  });
  return databasePromise;
}

async function migrateAsyncStorageCache(db: SQLiteDatabase): Promise<void> {
  const migrated = await db.getFirstAsync<{ value: string }>("SELECT value FROM cache_metadata WHERE key = ?", MIGRATION_KEY);
  if (migrated) return;

  const [currentRaw, legacyRaw] = await AsyncStorage.multiGet([CACHE_KEY, LEGACY_CACHE_KEY]);
  const raw = currentRaw?.[1] ?? legacyRaw?.[1];
  if (raw) {
    await replaceCache(db, parseLegacyCache(raw) ?? EMPTY_CACHE, true);
  } else {
    await db.runAsync("INSERT OR REPLACE INTO cache_metadata (key, value) VALUES (?, ?)", MIGRATION_KEY, "1");
  }

  // Remove JSON only after the SQLite transaction and its migration marker commit.
  await AsyncStorage.multiRemove([CACHE_KEY, LEGACY_CACHE_KEY]);
}

async function replaceCache(db: SQLiteDatabase, input: CachedState, markMigrated = false): Promise<void> {
  const cache = boundedCachedState(input);
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const previous = await transaction.getFirstAsync<{ value: string }>("SELECT value FROM cache_metadata WHERE key = 'write_generation'");
    const generation = (Number(previous?.value) || 0) + 1;

    await transaction.runAsync("INSERT OR REPLACE INTO cache_metadata (key, value) VALUES ('bootstrap', ?)", JSON.stringify(cache.bootstrap));
    await transaction.runAsync("INSERT OR REPLACE INTO cache_metadata (key, value) VALUES ('cached_at', ?)", String(cache.cachedAt));
    await transaction.runAsync("INSERT OR REPLACE INTO cache_metadata (key, value) VALUES ('write_generation', ?)", String(generation));

    const upsert = await transaction.prepareAsync(
      `INSERT INTO cached_messages (stream_id, message_id, sequence, created_at, write_generation, payload)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(stream_id, message_id) DO UPDATE SET
         sequence = excluded.sequence,
         created_at = excluded.created_at,
         write_generation = excluded.write_generation,
         payload = excluded.payload`,
    );
    try {
      for (const [streamId, messages] of Object.entries(cache.messages)) {
        for (const message of messages) {
          await upsert.executeAsync(streamId, message.id, message.sequence, message.createdAt, generation, JSON.stringify(message));
        }
      }
    } finally {
      await upsert.finalizeAsync();
    }

    // Rows outside the bounded projection disappear without a large NOT IN list.
    await transaction.runAsync("DELETE FROM cached_messages WHERE write_generation <> ?", generation);
    if (markMigrated) await transaction.runAsync("INSERT OR REPLACE INTO cache_metadata (key, value) VALUES (?, ?)", MIGRATION_KEY, "1");
  });
}

export async function readCache(): Promise<CachedState> {
  try {
    const db = await database();
    const [bootstrapRow, cachedAtRow, messageRows] = await Promise.all([
      db.getFirstAsync<{ value: string }>("SELECT value FROM cache_metadata WHERE key = 'bootstrap'"),
      db.getFirstAsync<{ value: string }>("SELECT value FROM cache_metadata WHERE key = 'cached_at'"),
      db.getAllAsync<CachedMessageRow>("SELECT stream_id, payload FROM cached_messages ORDER BY stream_id, sequence ASC"),
    ]);
    let bootstrap: CachedState["bootstrap"] = null;
    if (bootstrapRow) {
      try { bootstrap = JSON.parse(bootstrapRow.value) as CachedState["bootstrap"]; } catch { bootstrap = null; }
    }
    return {
      bootstrap,
      messages: decodeMessageRows(messageRows),
      cachedAt: Number(cachedAtRow?.value) || 0,
    };
  } catch (error) {
    console.warn("Could not read SQLite offline cache", error);
    const [currentRaw, legacyRaw] = await AsyncStorage.multiGet([CACHE_KEY, LEGACY_CACHE_KEY]);
    return parseLegacyCache(currentRaw?.[1] ?? legacyRaw?.[1] ?? null) ?? EMPTY_CACHE;
  }
}

export async function readCachedMessagePage(streamId: string, before?: number, limit?: number): Promise<Message[]> {
  const db = await database();
  const pageSize = clampCachePageSize(limit);
  const rows = before === undefined
    ? await db.getAllAsync<CachedMessageRow>("SELECT stream_id, payload FROM cached_messages WHERE stream_id = ? ORDER BY sequence DESC LIMIT ?", streamId, pageSize)
    : await db.getAllAsync<CachedMessageRow>("SELECT stream_id, payload FROM cached_messages WHERE stream_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?", streamId, before, pageSize);
  return (decodeMessageRows([...rows].reverse())[streamId] ?? []);
}

export async function writeCache(cache: CachedState): Promise<void> {
  await replaceCache(await database(), cache);
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<OutboxEntry | (Omit<Extract<OutboxEntry, { kind: "message" }>, "kind"> & { kind?: undefined })>;
    return Array.isArray(parsed) ? parsed.map((entry) => entry.kind ? entry as OutboxEntry : { ...entry, kind: "message" }) : [];
  } catch {
    return [];
  }
}

export async function writeOutbox(entries: OutboxEntry[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
}

export async function readDrafts(): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(DRAFTS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length <= 16_000));
  } catch {
    return {};
  }
}

export async function writeDrafts(drafts: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

export async function clearLocalData(): Promise<void> {
  const clearDatabase = database().then((db) => db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync("DELETE FROM cached_messages; DELETE FROM cache_metadata;");
  })).catch((error) => console.warn("Could not clear SQLite offline cache", error));
  await Promise.all([clearDatabase, AsyncStorage.multiRemove([CACHE_KEY, LEGACY_CACHE_KEY, OUTBOX_KEY, DRAFTS_KEY])]);
}
