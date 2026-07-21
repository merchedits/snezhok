import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("call joins and idempotent media-plane commands are durable", async () => {
  const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
  const db = new PGlite();
  try {
    await db.exec(await readFile(path.join(migrations, "0001_initial.sql"), "utf8"));
    await db.exec(await readFile(path.join(migrations, "0008_push_notifications_calls.sql"), "utf8"));
    await db.exec(await readFile(path.join(migrations, "0016_call_media_control.sql"), "utf8"));
    const user = "10000000-0000-4000-8000-000000000001";
    const call = "20000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'call_user','Call user')", [user]);
    await db.query("INSERT INTO call_sessions(id,stream_kind,stream_id,livekit_room,started_by) VALUES ($1,'conversation',gen_random_uuid(),'room-1',$2)", [call, user]);
    await db.query("INSERT INTO call_participant_presence(call_session_id,user_id) VALUES ($1,$2)", [call, user]);
    await db.query("UPDATE call_sessions SET first_participant_joined_at=now() WHERE id=$1", [call]);
    await db.query("INSERT INTO call_media_commands(call_session_id,action,livekit_room,reason) VALUES ($1,'delete_room','room-1','test')", [call]);
    await db.query("INSERT INTO call_media_commands(call_session_id,action,livekit_room,reason) VALUES ($1,'delete_room','room-1','duplicate') ON CONFLICT DO NOTHING", [call]);
    const result = await db.query<{ joined: boolean; commands: number; join_count: number }>(
      `SELECT call.first_participant_joined_at IS NOT NULL joined,
        (SELECT count(*)::integer FROM call_media_commands WHERE call_session_id=call.id) commands,
        presence.join_count
       FROM call_sessions call JOIN call_participant_presence presence ON presence.call_session_id=call.id
       WHERE call.id=$1`,
      [call],
    );
    assert.deepEqual(result.rows[0], { joined: true, commands: 1, join_count: 1 });
    await assert.rejects(db.query(
      "INSERT INTO call_media_commands(call_session_id,action,livekit_room,reason) VALUES ($1,'remove_participant','room-1','invalid')",
      [call],
    ));
  } finally {
    await db.close();
  }
});
