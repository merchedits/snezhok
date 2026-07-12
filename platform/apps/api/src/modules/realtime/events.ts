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
      if (inserted.rows[0]) event.cursors[recipientId] = Number(inserted.rows[0].cursor);
    }
  }
  await client.query("SELECT pg_notify('snezhok_events',$1)", [event.id]);
  return event;
}

export async function eventsAfter(userId: string, cursor: number, limit = 500) {
  const result = await pool.query<{ cursor: string; name: string; payload: unknown }>(
    `SELECT ue.cursor::text,e.name,ue.payload FROM user_events ue JOIN events e ON e.id=ue.event_id
     WHERE ue.user_id=$1 AND ue.cursor>$2 ORDER BY ue.cursor ASC LIMIT $3`,
    [userId, cursor, limit],
  );
  return result.rows.map((row) => ({ cursor: Number(row.cursor), name: row.name, payload: row.payload }));
}

export async function eventDelivery(eventId: string) {
  const result = await pool.query<{ user_id: string; cursor: string; name: string; payload: unknown }>(
    `SELECT ue.user_id,ue.cursor::text,e.name,ue.payload FROM user_events ue JOIN events e ON e.id=ue.event_id WHERE e.id=$1`,
    [eventId],
  );
  return result.rows.map((row) => ({ userId: row.user_id, cursor: Number(row.cursor), name: row.name, payload: row.payload }));
}

export async function currentCursor(userId: string, client: Pick<DbClient, "query"> = pool) {
  const result = await client.query<{ cursor: string }>("SELECT coalesce(max(cursor),0)::text AS cursor FROM user_events WHERE user_id=$1", [userId]);
  return Number(result.rows[0]?.cursor ?? 0);
}
