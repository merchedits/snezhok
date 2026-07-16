import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import type { DbClient } from "../../db/pool.js";
import { replayEvents, storeEvent } from "./events.js";

const userId = "10000000-0000-4000-8000-000000000001";
const staleUserId = "10000000-0000-4000-8000-000000000002";

test("push-eligible events enter the durable outbox in the same event transaction", async () => {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const fakeClient = {
    query: (async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (sql.includes("INSERT INTO user_events")) return { rows: [{ cursor: "7" }] };
      return { rows: [] };
    }) as DbClient["query"],
  } as Pick<DbClient, "query"> as DbClient;
  const event = await storeEvent(fakeClient, [userId], "message:created", (recipientId: string) => ({ recipientId, text: "hello" }));
  assert.equal(event.cursors[userId], 7);
  const outbox = statements.find((statement) => statement.sql.includes("INSERT INTO push_delivery_outbox"));
  assert.ok(outbox, "provider delivery must be committed alongside its user event");
  assert.deepEqual(outbox.params.slice(0, 3), [userId, event.id, "message:created"]);
  assert.deepEqual(outbox.params[3], { recipientId: userId, text: "hello" });
  assert.ok(statements.at(-1)?.sql.includes("pg_notify"), "NOTIFY remains a post-storage realtime hint");
});

test("realtime replay drains more than 500 events in ordered bounded pages without gaps", async () => {
  const db = new PGlite();
  try {
    await applyMigrations(db);
    await db.query(
      "INSERT INTO users(id,username,display_name) VALUES ($1,'replay_user','Replay'),($2,'stale_user','Stale')",
      [userId, staleUserId],
    );
    await db.query(
      `INSERT INTO events(id,name,payload)
       SELECT gen_random_uuid(),'message:updated',jsonb_build_object('index',value)
       FROM generate_series(1,1201) value`,
    );
    await db.query(
      `INSERT INTO user_events(user_id,event_id,payload)
       SELECT $1,id,payload FROM events ORDER BY (payload->>'index')::int`,
      [userId],
    );

    let pageQueries = 0;
    const client = countingClient(db, (sql) => {
      if (sql.includes("ORDER BY ue.cursor ASC LIMIT")) pageQueries += 1;
    });
    const received: number[] = [];
    const replay = await replayEvents(userId, 0, (event) => { received.push(event.cursor); }, { batchSize: 500, client });

    assert.equal(replay.accepted, true);
    assert.equal(replay.eventCount, 1201);
    assert.equal(received.length, 1201);
    assert.ok(received.every((cursor, index) => index === 0 || cursor > received[index - 1]!));
    assert.equal(replay.cursor, received.at(-1));
    assert.equal(pageQueries, 3, "1201 rows must be drained as 500 + 500 + 201");

    const bounded = await replayEvents(userId, 0, () => assert.fail("oversized replay must fail before emitting"), { maxEvents: 1_000, client });
    assert.deepEqual({ accepted: bounded.accepted, eventCount: bounded.eventCount, reason: bounded.reason }, { accepted: false, eventCount: 0, reason: "backlog-too-large" });
  } finally {
    await db.close();
  }
});

test("realtime replay rejects a cursor behind the durable retention watermark", async () => {
  const db = new PGlite();
  try {
    await applyMigrations(db);
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'stale_user','Stale')", [staleUserId]);
    await db.query("INSERT INTO event_retention_watermarks(user_id,discarded_through_cursor) VALUES ($1,50)", [staleUserId]);
    const replay = await replayEvents(staleUserId, 49, () => assert.fail("a retention gap must not emit a partial replay"), {
      client: db as unknown as Pick<DbClient, "query">,
    });
    assert.equal(replay.accepted, false);
    assert.equal(replay.reason, "retention-gap");
    assert.equal(replay.cursor, 50);
  } finally {
    await db.close();
  }
});

async function applyMigrations(db: PGlite): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrations = path.resolve(here, "../../../migrations");
  for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(migrations, filename), "utf8"));
  }
}

function countingClient(db: PGlite, count: (sql: string) => void): Pick<DbClient, "query"> {
  return {
    query: ((sql: string, params?: unknown[]) => {
      count(sql);
      return db.query(sql, params);
    }) as DbClient["query"],
  };
}
