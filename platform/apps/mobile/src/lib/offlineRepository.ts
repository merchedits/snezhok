import AsyncStorage from "@react-native-async-storage/async-storage";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import type { AppSettings, BootstrapPayload, Message } from "@snezhok/contracts";

import { recordDiagnostic } from "../diagnostics/diagnostics";
import { decodeOutboxRecords } from "../repositories/mutations/outboxRecord";

import type { CachedState, OutboxEntry } from "../types";
import { PENDING_UPLOAD_KEY } from "./pendingUpload";
import {
  cachedStreamDelta,
  clampCachePageSize,
  decodeMessageRowsDetailed,
  importantCachedMessage,
  parseLegacyCache,
  startupStreamIds,
  type CachedMessageRow,
} from "./offlineCachePolicy";

const DATABASE_NAME = "snezhok-offline.db";
const CACHE_KEY = "@snezhok/cache/v2";
const LEGACY_CACHE_KEY = "@snezhok/cache/v1";
const OUTBOX_KEY = "@snezhok/outbox/v1";
const DRAFTS_KEY = "@snezhok/drafts/v1";
const DRAFT_DIRTY_KEY = "@snezhok/drafts-dirty/v1";
const SETTINGS_DIRTY_KEY = "@snezhok/settings-dirty/v1";
const OWNER_KEY = "@snezhok/offline-owner/v1";
const MIGRATION_KEY = "async_storage_v2_migrated";

const EMPTY_CACHE: CachedState = { bootstrap: null, messages: {}, cachedAt: 0 };

export interface OfflineCacheDelta {
  /** Omitted means unchanged; null deliberately clears signed-in metadata. */
  bootstrap?: BootstrapPayload | null;
  cachedAt: number;
  /** Complete bounded projections for only the streams that changed. */
  streams?: Record<string, Message[]>;
  removedStreamIds?: string[];
  removedMessageIds?: Record<string, string[]>;
}

interface StoredMessageRow extends CachedMessageRow {
  message_id: string;
  important: number;
}

let databasePromise: Promise<SQLiteDatabase> | null = null;
let ownerQueue: Promise<void> = Promise.resolve();

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
        write_generation INTEGER NOT NULL DEFAULT 0,
        important INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL,
        PRIMARY KEY (stream_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS cached_messages_stream_sequence
        ON cached_messages (stream_id, sequence DESC);
      CREATE TABLE IF NOT EXISTS quarantined_cached_messages (
        stream_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        quarantined_at INTEGER NOT NULL,
        PRIMARY KEY (stream_id, message_id)
      );
    `);
    await migrateSchema(db);
    await migrateAsyncStorageCache(db);
    return db;
  });
  return databasePromise;
}

async function migrateSchema(db: SQLiteDatabase): Promise<void> {
  const versionRow = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const previousVersion = Number(versionRow?.user_version) || 0;
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(cached_messages)");
  const addedImportantColumn = !columns.some((column) => column.name === "important");
  if (addedImportantColumn) {
    await db.execAsync("ALTER TABLE cached_messages ADD COLUMN important INTEGER NOT NULL DEFAULT 0;");
  }
  if (previousVersion < 2 || addedImportantColumn) {
    const rows = await db.getAllAsync<StoredMessageRow>("SELECT stream_id, message_id, payload, 0 AS important FROM cached_messages");
    await db.withExclusiveTransactionAsync(async (transaction) => {
      const update = await transaction.prepareAsync("UPDATE cached_messages SET important = 1 WHERE stream_id = ? AND message_id = ?");
      try {
        for (const row of rows) {
          try {
            if (importantCachedMessage(JSON.parse(row.payload) as Message)) await update.executeAsync(row.stream_id, row.message_id);
          } catch {
            // Damaged legacy rows are ignored and removed on the next stream sync.
          }
        }
      } finally {
        await update.finalizeAsync();
      }
    });
  }
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS cached_messages_important
      ON cached_messages (important, stream_id);
    CREATE INDEX IF NOT EXISTS quarantined_cached_messages_at
      ON quarantined_cached_messages (quarantined_at DESC);
    PRAGMA user_version = 3;
  `);
}

async function migrateAsyncStorageCache(db: SQLiteDatabase): Promise<void> {
  const migrated = await db.getFirstAsync<{ value: string }>("SELECT value FROM cache_metadata WHERE key = ?", MIGRATION_KEY);
  if (migrated) return;

  const [currentRaw, legacyRaw] = await AsyncStorage.multiGet([CACHE_KEY, LEGACY_CACHE_KEY]);
  const raw = currentRaw?.[1] ?? legacyRaw?.[1];
  const legacy = raw ? parseLegacyCache(raw) : null;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    if (legacy) {
      await transaction.runAsync("DELETE FROM cached_messages");
      await persistCacheDelta(transaction, {
        bootstrap: legacy.bootstrap,
        cachedAt: legacy.cachedAt,
        streams: legacy.messages,
      });
    }
    await transaction.runAsync("INSERT OR REPLACE INTO cache_metadata (key, value) VALUES (?, ?)", MIGRATION_KEY, "1");
  });

  // Remove JSON only after the SQLite transaction and migration marker commit.
  await AsyncStorage.multiRemove([CACHE_KEY, LEGACY_CACHE_KEY]);
}

async function persistCacheDelta(db: SQLiteDatabase, delta: OfflineCacheDelta): Promise<void> {
  if ("bootstrap" in delta) {
    await writeMetadata(db, "bootstrap", JSON.stringify(delta.bootstrap ?? null));
  }
  await writeMetadata(db, "cached_at", String(delta.cachedAt));

  for (const streamId of delta.removedStreamIds ?? []) {
    await db.runAsync("DELETE FROM cached_messages WHERE stream_id = ?", streamId);
  }

  const explicitRemovals = Object.entries(delta.removedMessageIds ?? {});
  if (explicitRemovals.length) {
    const removeMessage = await db.prepareAsync("DELETE FROM cached_messages WHERE stream_id = ? AND message_id = ?");
    try {
      for (const [streamId, messageIds] of explicitRemovals) {
        for (const messageId of messageIds) await removeMessage.executeAsync(streamId, messageId);
      }
    } finally {
      await removeMessage.finalizeAsync();
    }
  }

  const streams = Object.entries(delta.streams ?? {});
  if (streams.length === 0) return;
  const upsert = await db.prepareAsync(
    `INSERT INTO cached_messages (stream_id, message_id, sequence, created_at, write_generation, important, payload)
     VALUES (?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(stream_id, message_id) DO UPDATE SET
       sequence = excluded.sequence,
       created_at = excluded.created_at,
       write_generation = 0,
       important = excluded.important,
       payload = excluded.payload`,
  );
  const remove = await db.prepareAsync("DELETE FROM cached_messages WHERE stream_id = ? AND message_id = ?");
  const prune = await db.prepareAsync(
    `DELETE FROM cached_messages
     WHERE stream_id = ? AND important = 0 AND message_id NOT IN (
       SELECT message_id FROM cached_messages
       WHERE stream_id = ? AND important = 0
       ORDER BY sequence DESC LIMIT 300
     )`,
  );
  try {
    for (const [streamId, input] of streams) {
      const existingRows = await db.getAllAsync<StoredMessageRow>(
        "SELECT stream_id, message_id, important, payload FROM cached_messages WHERE stream_id = ?",
        streamId,
      );
      const delta = cachedStreamDelta(existingRows, input);
      for (const { message, payload, important } of delta.upserts) {
        await upsert.executeAsync(streamId, message.id, message.sequence, message.createdAt, important, payload);
        await db.runAsync("DELETE FROM quarantined_cached_messages WHERE stream_id = ? AND message_id = ?", streamId, message.id);
      }
      for (const messageId of delta.removedIds) {
        await remove.executeAsync(streamId, messageId);
      }
      await prune.executeAsync(streamId, streamId);
    }
  } finally {
    await Promise.allSettled([upsert.finalizeAsync(), remove.finalizeAsync(), prune.finalizeAsync()]);
  }
}

async function writeMetadata(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO cache_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value
     WHERE cache_metadata.value <> excluded.value`,
    key,
    value,
  );
}

export async function readCache(): Promise<CachedState> {
  try {
    const db = await database();
    const [bootstrapRow, cachedAtRow] = await Promise.all([
      db.getFirstAsync<{ value: string }>("SELECT value FROM cache_metadata WHERE key = 'bootstrap'"),
      db.getFirstAsync<{ value: string }>("SELECT value FROM cache_metadata WHERE key = 'cached_at'"),
    ]);
    let bootstrap: CachedState["bootstrap"] = null;
    if (bootstrapRow) {
      try { bootstrap = JSON.parse(bootstrapRow.value) as CachedState["bootstrap"]; } catch { bootstrap = null; }
    }
    const ownerRow = await db.getFirstAsync<{ value: string }>("SELECT value FROM cache_metadata WHERE key = 'owner_id'");
    if (bootstrap && ownerRow?.value && ownerRow.value !== bootstrap.me.id) {
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.execAsync("DELETE FROM cached_messages; DELETE FROM quarantined_cached_messages; DELETE FROM cache_metadata;");
      });
      return EMPTY_CACHE;
    }
    if (bootstrap && !ownerRow) await writeMetadata(db, "owner_id", bootstrap.me.id);

    const selectedStreams = startupStreamIds(bootstrap);
    const [importantRows, startupRows] = await Promise.all([
      db.getAllAsync<CachedMessageRow>("SELECT stream_id, message_id, payload FROM cached_messages WHERE important = 1 ORDER BY created_at DESC LIMIT 200"),
      cachedStartupRows(db, selectedStreams, 40),
    ]);
    return {
      bootstrap,
      messages: await decodeAndQuarantineMessageRows(db, [...importantRows, ...startupRows]),
      cachedAt: Number(cachedAtRow?.value) || 0,
    };
  } catch (error) {
    recordDiagnostic("warn", "storage", "SQLite cache unavailable; using legacy cache", { error });
    const [currentRaw, legacyRaw] = await AsyncStorage.multiGet([CACHE_KEY, LEGACY_CACHE_KEY]);
    return parseLegacyCache(currentRaw?.[1] ?? legacyRaw?.[1] ?? null) ?? EMPTY_CACHE;
  }
}

async function cachedStartupRows(db: SQLiteDatabase, streamIds: string[], limit: number): Promise<CachedMessageRow[]> {
  if (!streamIds.length) return [];
  const placeholders = streamIds.map(() => "?").join(", ");
  return db.getAllAsync<CachedMessageRow>(
    `SELECT stream_id, message_id, payload FROM (
       SELECT stream_id, message_id, payload, sequence,
         ROW_NUMBER() OVER (PARTITION BY stream_id ORDER BY sequence DESC) AS row_number
       FROM cached_messages WHERE stream_id IN (${placeholders})
     ) WHERE row_number <= ? ORDER BY stream_id, sequence ASC`,
    ...streamIds,
    clampCachePageSize(limit),
  );
}

async function cachedMessageRows(db: SQLiteDatabase, streamId: string, before?: number, limit?: number): Promise<CachedMessageRow[]> {
  const pageSize = clampCachePageSize(limit);
  const rows = before === undefined
    ? await db.getAllAsync<CachedMessageRow>("SELECT stream_id, message_id, payload FROM cached_messages WHERE stream_id = ? ORDER BY sequence DESC LIMIT ?", streamId, pageSize)
    : await db.getAllAsync<CachedMessageRow>("SELECT stream_id, message_id, payload FROM cached_messages WHERE stream_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?", streamId, before, pageSize);
  return [...rows].reverse();
}

function uniqueDecodedMessages(decoded: Record<string, Message[]>): Record<string, Message[]> {
  return Object.fromEntries(Object.entries(decoded).map(([streamId, messages]) => {
    const byId = new Map(messages.map((message) => [message.id, message]));
    return [streamId, [...byId.values()].sort((left, right) => left.sequence - right.sequence || left.createdAt - right.createdAt)];
  }));
}

async function decodeAndQuarantineMessageRows(db: SQLiteDatabase, rows: CachedMessageRow[]): Promise<Record<string, Message[]>> {
  const decoded = decodeMessageRowsDetailed(rows);
  const rejected = decoded.rejected.filter((row): row is typeof row & { messageId: string } => Boolean(row.messageId));
  if (rejected.length) {
    await db.withExclusiveTransactionAsync(async (transaction) => {
      const quarantine = await transaction.prepareAsync(
        `INSERT INTO quarantined_cached_messages (stream_id, message_id, reason, quarantined_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(stream_id, message_id) DO UPDATE SET
           reason = excluded.reason,
           quarantined_at = excluded.quarantined_at`,
      );
      const remove = await transaction.prepareAsync("DELETE FROM cached_messages WHERE stream_id = ? AND message_id = ?");
      try {
        const quarantinedAt = Date.now();
        for (const row of rejected) {
          await quarantine.executeAsync(row.streamId, row.messageId, row.reason, quarantinedAt);
          await remove.executeAsync(row.streamId, row.messageId);
        }
      } finally {
        await Promise.allSettled([quarantine.finalizeAsync(), remove.finalizeAsync()]);
      }
    });
    recordDiagnostic("warn", "storage", "Invalid cached messages were quarantined", {
      count: rejected.length,
      repaired: decoded.repaired,
    });
  } else if (decoded.repaired) {
    recordDiagnostic("info", "storage", "Legacy cached messages were repaired", { count: decoded.repaired });
  }
  return uniqueDecodedMessages(decoded.messages);
}

export async function readCachedMessagePage(streamId: string, before?: number, limit?: number): Promise<Message[]> {
  const db = await database();
  const rows = await cachedMessageRows(db, streamId, before, limit);
  if (before !== undefined) return (await decodeAndQuarantineMessageRows(db, rows))[streamId] ?? [];
  const importantRows = await db.getAllAsync<CachedMessageRow>(
    "SELECT stream_id, message_id, payload FROM cached_messages WHERE stream_id = ? AND important = 1 ORDER BY created_at DESC LIMIT 100",
    streamId,
  );
  return (await decodeAndQuarantineMessageRows(db, [...importantRows, ...rows]))[streamId] ?? [];
}

/** Restores several first pages in one SQLite query for idle inbox warmup. */
export async function readCachedMessagePages(streamIds: readonly string[], limit = 40): Promise<Record<string, Message[]>> {
  const uniqueIds = [...new Set(streamIds.filter(Boolean))];
  if (!uniqueIds.length) return {};
  const db = await database();
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const [recentRows, importantRows] = await Promise.all([
    cachedStartupRows(db, uniqueIds, limit),
    db.getAllAsync<CachedMessageRow>(
      `SELECT stream_id, message_id, payload FROM cached_messages
       WHERE important = 1 AND stream_id IN (${placeholders})
       ORDER BY created_at DESC LIMIT ?`,
      ...uniqueIds,
      clampCachePageSize(limit) * uniqueIds.length,
    ),
  ]);
  return decodeAndQuarantineMessageRows(db, [...importantRows, ...recentRows]);
}

/** Incrementally sync only dirty streams and changed metadata. */
export async function writeCacheDelta(delta: OfflineCacheDelta): Promise<void> {
  const db = await database();
  await db.withExclusiveTransactionAsync((transaction) => persistCacheDelta(transaction, delta));
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const decoded = decodeOutboxRecords(JSON.parse(raw) as unknown);
    if (decoded.rejected) recordDiagnostic("warn", "storage", "Invalid durable mutation records were quarantined", { count: decoded.rejected });
    return decoded.entries;
  } catch {
    recordDiagnostic("warn", "storage", "Durable mutation queue could not be decoded");
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

export async function readDirtyDraftIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(DRAFT_DIRTY_KEY);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

export async function writeDirtyDraftIds(ids: Iterable<string>): Promise<void> {
  await AsyncStorage.setItem(DRAFT_DIRTY_KEY, JSON.stringify([...new Set(ids)]));
}

export async function readPendingSettingsPatch(): Promise<Partial<AppSettings>> {
  const raw = await AsyncStorage.getItem(SETTINGS_DIRTY_KEY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<AppSettings> : {};
  } catch {
    return {};
  }
}

export async function writePendingSettingsPatch(patch: Partial<AppSettings>): Promise<void> {
  if (Object.keys(patch).length === 0) {
    await AsyncStorage.removeItem(SETTINGS_DIRTY_KEY);
    return;
  }
  await AsyncStorage.setItem(SETTINGS_DIRTY_KEY, JSON.stringify(patch));
}

export async function clearLocalData(): Promise<void> {
  const clearDatabase = database().then((db) => db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync("DELETE FROM cached_messages; DELETE FROM quarantined_cached_messages; DELETE FROM cache_metadata;");
  })).catch((error) => recordDiagnostic("warn", "storage", "SQLite cache clear failed", { error }));
  await Promise.all([clearDatabase, AsyncStorage.multiRemove([CACHE_KEY, LEGACY_CACHE_KEY, OUTBOX_KEY, DRAFTS_KEY, DRAFT_DIRTY_KEY, SETTINGS_DIRTY_KEY, PENDING_UPLOAD_KEY, OWNER_KEY])]);
}

/** Serializes account changes so durable data cannot bleed between logins. */
export function ensureOfflineOwner(ownerId: string): Promise<void> {
  ownerQueue = ownerQueue.catch(() => undefined).then(async () => {
    const db = await database();
    const storageOwner = await AsyncStorage.getItem(OWNER_KEY);
    let changed = false;
    await db.withExclusiveTransactionAsync(async (transaction) => {
      const row = await transaction.getFirstAsync<{ value: string }>("SELECT value FROM cache_metadata WHERE key = 'owner_id'");
      const bootstrapRow = await transaction.getFirstAsync<{ value: string }>("SELECT value FROM cache_metadata WHERE key = 'bootstrap'");
      let bootstrapOwner: string | null = null;
      try {
        const bootstrap = bootstrapRow?.value ? JSON.parse(bootstrapRow.value) as Partial<BootstrapPayload> : null;
        bootstrapOwner = bootstrap?.me?.id ?? null;
      } catch {
        // Invalid account metadata is unowned and therefore cannot be reused.
        bootstrapOwner = bootstrapRow?.value ? "__invalid__" : null;
      }
      changed = Boolean(
        (!row?.value && !storageOwner)
        || (row?.value && row.value !== ownerId)
        || (storageOwner && storageOwner !== ownerId)
        || (bootstrapOwner && bootstrapOwner !== ownerId),
      );
      if (changed) await transaction.execAsync("DELETE FROM cached_messages; DELETE FROM quarantined_cached_messages; DELETE FROM cache_metadata;");
      await writeMetadata(transaction, "owner_id", ownerId);
    });
    if (changed || (storageOwner && storageOwner !== ownerId)) {
      await AsyncStorage.multiRemove([CACHE_KEY, LEGACY_CACHE_KEY, OUTBOX_KEY, DRAFTS_KEY, DRAFT_DIRTY_KEY, SETTINGS_DIRTY_KEY, PENDING_UPLOAD_KEY]);
    }
    await AsyncStorage.setItem(OWNER_KEY, ownerId);
  });
  return ownerQueue;
}
