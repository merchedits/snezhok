import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("reliability migration provides durable push delivery and replay watermarks", async () => {
  const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
  const db = new PGlite();
  try {
    await db.exec(await readFile(path.join(migrations, "0001_initial.sql"), "utf8"));
    await db.exec(await readFile(path.join(migrations, "0008_push_notifications_calls.sql"), "utf8"));
    await db.exec(await readFile(path.join(migrations, "0009_reliability_foundation.sql"), "utf8"));
    const userId = "10000000-0000-4000-8000-000000000001";
    const eventId = "20000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'delivery_user','Delivery')", [userId]);
    await db.query("INSERT INTO event_retention_watermarks(user_id,discarded_through_cursor) VALUES ($1,42)", [userId]);
    await db.query(
      "INSERT INTO push_delivery_outbox(user_id,event_id,event_name,payload) VALUES ($1,$2,'message:created',$3)",
      [userId, eventId, { text: "durable" }],
    );
    await assert.rejects(
      db.query("INSERT INTO push_delivery_outbox(user_id,event_id,event_name,payload) VALUES ($1,$2,'message:created','{}')", [userId, eventId]),
      /unique|duplicate/i,
    );
    const state = await db.query<{ discarded_through_cursor: string; status: string }>(
      `SELECT watermark.discarded_through_cursor::text,outbox.status
       FROM event_retention_watermarks watermark JOIN push_delivery_outbox outbox ON outbox.user_id=watermark.user_id
       WHERE watermark.user_id=$1`,
      [userId],
    );
    assert.deepEqual(state.rows, [{ discarded_through_cursor: "42", status: "pending" }]);
  } finally {
    await db.close();
  }
});
