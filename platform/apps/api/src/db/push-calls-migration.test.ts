import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("push devices and call response lifecycle are durable", async () => {
  const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
  const db = new PGlite();
  try {
    await db.exec(await readFile(path.join(migrations, "0001_initial.sql"), "utf8"));
    await db.exec(await readFile(path.join(migrations, "0008_push_notifications_calls.sql"), "utf8"));
    const userId = "00000000-0000-4000-8000-000000000001";
    const callId = "00000000-0000-4000-8000-000000000002";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'push_test','Push test')", [userId]);
    await db.query("INSERT INTO push_devices(id,user_id,expo_push_token,platform,installation_id,app_version) VALUES (gen_random_uuid(),$1,'ExpoPushToken[test]','android','install-0001','3.6.2')", [userId]);
    await db.query("INSERT INTO call_sessions(id,stream_kind,stream_id,livekit_room,started_by,answered_by,declined_by) VALUES ($1,'conversation',gen_random_uuid(),'room-test',$2,ARRAY[$2]::uuid[],ARRAY[]::uuid[])", [callId, userId]);
    const call = await db.query<{ answered_by: string[]; declined_by: string[] }>("SELECT answered_by,declined_by FROM call_sessions WHERE id=$1", [callId]);
    assert.deepEqual(call.rows[0]?.answered_by, [userId]);
    assert.deepEqual(call.rows[0]?.declined_by, []);
  } finally {
    await db.close();
  }
});
