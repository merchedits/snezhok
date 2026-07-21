import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import type { DbClient } from "../../db/pool.js";
import { terminateCallsForUser, terminateServerCalls } from "./mediaControl.js";

async function migratedDatabase(): Promise<PGlite> {
  const db = new PGlite();
  const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../migrations");
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(migrations, file), "utf8"));
  }
  return db;
}

test("authorization mutations durably end every active server room and publish call events", async () => {
  const db = await migratedDatabase();
  try {
    const user = "10000000-0000-4000-8000-000000000001";
    const server = "20000000-0000-4000-8000-000000000001";
    const firstChannel = "30000000-0000-4000-8000-000000000001";
    const secondChannel = "30000000-0000-4000-8000-000000000002";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'owner_user','Owner')", [user]);
    await db.query("INSERT INTO servers(id,owner_id,name) VALUES ($1,$2,'Server')", [server, user]);
    await db.query("INSERT INTO server_members(server_id,user_id,role) VALUES ($1,$2,'owner')", [server, user]);
    await db.query("INSERT INTO channels(id,server_id,kind,name) VALUES ($1,$3,'voice','voice-one'),($2,$3,'voice','voice-two')", [firstChannel, secondChannel, server]);
    await db.query(
      `INSERT INTO call_sessions(id,stream_kind,stream_id,livekit_room,started_by)
       VALUES (gen_random_uuid(),'channel',$1,'room-one',$3),(gen_random_uuid(),'channel',$2,'room-two',$3)`,
      [firstChannel, secondChannel, user],
    );
    const events = await terminateServerCalls(db as unknown as DbClient, server, "permission-changed");
    const active = await db.query<{ count: number }>("SELECT count(*)::integer count FROM call_sessions WHERE ended_at IS NULL");
    const commands = await db.query<{ count: number }>("SELECT count(*)::integer count FROM call_media_commands WHERE action='delete_room' AND status='pending'");
    const stored = await db.query<{ count: number }>("SELECT count(*)::integer count FROM events WHERE name='call:updated' AND payload->>'reason'='permission-changed'");
    assert.equal(events.length, 2);
    assert.equal(active.rows[0]?.count, 0);
    assert.equal(commands.rows[0]?.count, 2);
    assert.equal(stored.rows[0]?.count, 2);
  } finally {
    await db.close();
  }
});

test("user-wide termination ends every reachable room once and preserves unrelated calls", async () => {
  const db = await migratedDatabase();
  try {
    const target = "10000000-0000-4000-8000-000000000001";
    const other = "10000000-0000-4000-8000-000000000002";
    const targetConversation = "20000000-0000-4000-8000-000000000001";
    const sharedConversation = "20000000-0000-4000-8000-000000000002";
    const unrelatedConversation = "20000000-0000-4000-8000-000000000003";
    const targetServer = "30000000-0000-4000-8000-000000000001";
    const unrelatedServer = "30000000-0000-4000-8000-000000000002";
    const firstTargetChannel = "40000000-0000-4000-8000-000000000001";
    const secondTargetChannel = "40000000-0000-4000-8000-000000000002";
    const unrelatedChannel = "40000000-0000-4000-8000-000000000003";
    await db.query(
      "INSERT INTO users(id,username,display_name) VALUES ($1,'target_user','Target'),($2,'other_user','Other')",
      [target, other],
    );
    await db.query(
      `INSERT INTO conversations(id,kind,title,owner_id) VALUES
       ($1,'direct','',$4),($2,'group','Shared',$4),($3,'direct','',$5)`,
      [targetConversation, sharedConversation, unrelatedConversation, target, other],
    );
    await db.query(
      `INSERT INTO conversation_members(conversation_id,user_id,role) VALUES
       ($1,$4,'owner'),($2,$4,'member'),($2,$5,'owner'),($3,$5,'owner')`,
      [targetConversation, sharedConversation, unrelatedConversation, target, other],
    );
    await db.query(
      "INSERT INTO servers(id,owner_id,name) VALUES ($1,$3,'Target Server'),($2,$4,'Other Server')",
      [targetServer, unrelatedServer, target, other],
    );
    await db.query(
      "INSERT INTO server_members(server_id,user_id,role) VALUES ($1,$3,'owner'),($1,$4,'member'),($2,$4,'owner')",
      [targetServer, unrelatedServer, target, other],
    );
    await db.query(
      `INSERT INTO channels(id,server_id,kind,name) VALUES
       ($1,$4,'voice','first'),($2,$4,'voice','second'),($3,$5,'voice','unrelated')`,
      [firstTargetChannel, secondTargetChannel, unrelatedChannel, targetServer, unrelatedServer],
    );
    await db.query(
      `INSERT INTO call_sessions(id,stream_kind,stream_id,livekit_room,started_by) VALUES
       (gen_random_uuid(),'conversation',$1,'target-conversation',$7),
       (gen_random_uuid(),'conversation',$2,'shared-conversation',$8),
       (gen_random_uuid(),'conversation',$3,'unrelated-conversation',$8),
       (gen_random_uuid(),'channel',$4,'target-channel-one',$7),
       (gen_random_uuid(),'channel',$5,'target-channel-two',$8),
       (gen_random_uuid(),'channel',$6,'unrelated-channel',$8)`,
      [targetConversation, sharedConversation, unrelatedConversation, firstTargetChannel, secondTargetChannel, unrelatedChannel, target, other],
    );

    const events = await terminateCallsForUser(db as unknown as DbClient, target, "account-suspended");
    const duplicateEvents = await terminateCallsForUser(db as unknown as DbClient, target, "account-suspended");
    const activeRooms = await db.query<{ livekit_room: string }>("SELECT livekit_room FROM call_sessions WHERE ended_at IS NULL ORDER BY livekit_room");
    const commands = await db.query<{ livekit_room: string }>(
      "SELECT livekit_room FROM call_media_commands WHERE action='delete_room' AND reason='account-suspended' ORDER BY livekit_room",
    );
    const stored = await db.query<{ count: number }>(
      "SELECT count(*)::integer count FROM events WHERE name='call:updated' AND payload->>'reason'='account-suspended'",
    );

    assert.equal(events.length, 4);
    assert.equal(duplicateEvents.length, 0);
    assert.deepEqual(activeRooms.rows.map((row) => row.livekit_room), ["unrelated-channel", "unrelated-conversation"]);
    assert.deepEqual(commands.rows.map((row) => row.livekit_room), [
      "shared-conversation",
      "target-channel-one",
      "target-channel-two",
      "target-conversation",
    ]);
    assert.equal(stored.rows[0]?.count, 4);
  } finally {
    await db.close();
  }
});
