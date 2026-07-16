import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("channel permission and notification migrations preserve database invariants", async () => {
  const db = new PGlite();
  const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
  try {
    for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(path.join(migrations, file), "utf8"));
    const owner = "10000000-0000-4000-8000-000000000001";
    const server = "20000000-0000-4000-8000-000000000001";
    const channel = "30000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'owner_user','Owner')", [owner]);
    await db.query("INSERT INTO servers(id,owner_id,name) VALUES ($1,$2,'Server')", [server, owner]);
    await db.query("INSERT INTO server_members(server_id,user_id,role) VALUES ($1,$2,'owner')", [server, owner]);
    await db.query("INSERT INTO channels(id,server_id,kind,name) VALUES ($1,$2,'text','general')", [channel, server]);
    await db.query("INSERT INTO channel_everyone_permission_overrides(channel_id,deny_permissions) VALUES ($1,ARRAY['view_channels']::text[])", [channel]);
    await assert.rejects(db.query("UPDATE channel_everyone_permission_overrides SET allow_permissions=ARRAY['view_channels']::text[] WHERE channel_id=$1", [channel]));
    await db.query("INSERT INTO server_notification_settings(user_id,server_id,mentions_only) VALUES ($1,$2,true)", [owner, server]);
    assert.equal((await db.query("SELECT 1 FROM server_notification_settings WHERE user_id=$1", [owner])).rows.length, 1);
  } finally { await db.close(); }
});
