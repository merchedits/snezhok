import type { DbClient } from "../../db/pool.js";
import { pool } from "../../db/pool.js";
import { newId } from "../../lib/ids.js";

export interface StoredEvent {
  id: string;
  name: string;
  payload: unknown;
  recipients: string[];
  cursors: Record<string, number>;
}
export type RecipientPayload = unknown | ((recipientId: string) => unknown);
export interface ReplayEvent { cursor: number; name: string; payload: unknown; }
export interface ReplayResult { accepted: boolean; cursor: number; eventCount: number; reason?: "retention-gap" | "cursor-ahead" | "backlog-too-large"; }

const DEFAULT_REPLAY_BATCH_SIZE = 500;
const DEFAULT_MAX_REPLAY_EVENTS = 10_000;

// Kept as a compatibility boundary for domain services. Cross-process delivery
// is triggered by PostgreSQL NOTIFY when the surrounding transaction commits.
export function publishStoredEvent(_event: StoredEvent) {}

export async function storeEvent(client: DbClient, recipients: string[], name: string, payload: RecipientPayload): Promise<StoredEvent> {
  const uniqueRecipients = [...new Set(recipients)];
  const event: StoredEvent = { id: newId(), name, payload: typeof payload === "function" ? null : payload, recipients: uniqueRecipients, cursors: {} };
  await client.query("INSERT INTO events(id,name,payload) VALUES ($1,$2,$3)", [event.id, event.name, event.payload ?? {}]);
  if (uniqueRecipients.length) {
    for (const recipientId of uniqueRecipients) {
      const recipientPayload = typeof payload === "function" ? payload(recipientId) : payload;
      const inserted = await client.query<{ cursor: string }>(
        "INSERT INTO user_events(user_id,event_id,payload) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING cursor::text",
        [recipientId, event.id, recipientPayload],
      );
      if (inserted.rows[0]) {
        event.cursors[recipientId] = Number(inserted.rows[0].cursor);
        if (event.name === "message:created" || event.name === "call:updated") {
          await client.query(
            `INSERT INTO push_delivery_outbox(user_id,event_id,event_name,payload)
             VALUES ($1,$2,$3,$4) ON CONFLICT(user_id,event_id) DO NOTHING`,
            [recipientId, event.id, event.name, recipientPayload],
          );
        }
      }
    }
  }
  await client.query("SELECT pg_notify('snezhok_events',$1)", [event.id]);
  return event;
}

export async function eventsAfter(
  userId: string,
  cursor: number,
  limit = DEFAULT_REPLAY_BATCH_SIZE,
  throughCursor = Number.MAX_SAFE_INTEGER,
  client: Pick<DbClient, "query"> = pool,
): Promise<ReplayEvent[]> {
  const result = await client.query<{ cursor: string; name: string; payload: unknown }>(
    `SELECT ue.cursor::text,e.name,ue.payload FROM user_events ue JOIN events e ON e.id=ue.event_id
     WHERE ue.user_id=$1 AND ue.cursor>$2 AND ue.cursor<=$3 ORDER BY ue.cursor ASC LIMIT $4`,
    [userId, cursor, throughCursor, limit],
  );
  return result.rows.map((row) => ({ cursor: Number(row.cursor), name: row.name, payload: row.payload }));
}

/**
 * Replays a stable, bounded cursor window in database-sized pages. The target
 * cursor is captured before the first page, so events committed during replay
 * are left to normal realtime delivery instead of making the loop unbounded.
 * A cursor older than the retention watermark is rejected before anything is
 * emitted; the client can then rebuild from a bootstrap snapshot without an
 * invisible gap.
 */
export async function replayEvents(
  userId: string,
  cursor: number,
  emit: (event: ReplayEvent) => void | Promise<void>,
  options: {
    batchSize?: number;
    maxEvents?: number;
    client?: Pick<DbClient, "query">;
  } = {},
): Promise<ReplayResult> {
  const client = options.client ?? pool;
  const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_REPLAY_BATCH_SIZE, 1_000));
  const maxEvents = Math.max(batchSize, Math.min(options.maxEvents ?? DEFAULT_MAX_REPLAY_EVENTS, 50_000));
  const window = await replayWindow(userId, client);
  if (cursor < window.discardedThroughCursor) return { accepted: false, cursor: window.currentCursor, eventCount: 0, reason: "retention-gap" };
  if (cursor > window.currentCursor) return { accepted: false, cursor: window.currentCursor, eventCount: 0, reason: "cursor-ahead" };

  const count = await client.query<{ count: string }>(
    "SELECT count(*)::text count FROM user_events WHERE user_id=$1 AND cursor>$2 AND cursor<=$3",
    [userId, cursor, window.currentCursor],
  );
  if (Number(count.rows[0]?.count ?? 0) > maxEvents) {
    return { accepted: false, cursor: window.currentCursor, eventCount: 0, reason: "backlog-too-large" };
  }

  let replayCursor = cursor;
  let eventCount = 0;
  while (replayCursor < window.currentCursor) {
    const page = await eventsAfter(userId, replayCursor, batchSize, window.currentCursor, client);
    if (!page.length) {
      // Cursor values are global and can contain gaps belonging to other users.
      replayCursor = window.currentCursor;
      break;
    }
    for (const event of page) await emit(event);
    eventCount += page.length;
    replayCursor = page.at(-1)!.cursor;
  }
  return { accepted: true, cursor: window.currentCursor, eventCount };
}

export async function eventDelivery(eventId: string) {
  const result = await pool.query<{ user_id: string; cursor: string; name: string; payload: unknown }>(
    `SELECT ue.user_id,ue.cursor::text,e.name,ue.payload FROM user_events ue JOIN events e ON e.id=ue.event_id WHERE e.id=$1`,
    [eventId],
  );
  return result.rows.map((row) => ({ userId: row.user_id, cursor: Number(row.cursor), name: row.name, payload: row.payload }));
}

export async function currentCursor(userId: string, client: Pick<DbClient, "query"> = pool) {
  const result = await client.query<{ cursor: string }>(
    `SELECT greatest(
       coalesce((SELECT max(cursor) FROM user_events WHERE user_id=$1),0),
       coalesce((SELECT discarded_through_cursor FROM event_retention_watermarks WHERE user_id=$1),0)
     )::text cursor`,
    [userId],
  );
  return Number(result.rows[0]?.cursor ?? 0);
}

async function replayWindow(userId: string, client: Pick<DbClient, "query">): Promise<{ currentCursor: number; discardedThroughCursor: number }> {
  const result = await client.query<{ current_cursor: string; discarded_through_cursor: string }>(
    `SELECT greatest(
       coalesce((SELECT max(cursor) FROM user_events WHERE user_id=$1),0),
       coalesce((SELECT discarded_through_cursor FROM event_retention_watermarks WHERE user_id=$1),0)
     )::text current_cursor,
     coalesce((SELECT discarded_through_cursor FROM event_retention_watermarks WHERE user_id=$1),0)::text discarded_through_cursor`,
    [userId],
  );
  return {
    currentCursor: Number(result.rows[0]?.current_cursor ?? 0),
    discardedThroughCursor: Number(result.rows[0]?.discarded_through_cursor ?? 0),
  };
}
