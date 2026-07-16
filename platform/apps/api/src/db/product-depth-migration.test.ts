import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("product-depth migration creates privacy, roles, bans, audit and mention state", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrations = path.resolve(here, "../../migrations");
  const db = new PGlite();
  try {
    for (const name of [
      "0001_initial.sql", "0002_media_pipeline.sql", "0003_public_registration.sql",
      "0004_profile_photos.sql", "0005_saved_messages_forwarding.sql", "0006_hidden_messages.sql",
      "0007_chat_productivity.sql", "0008_push_notifications_calls.sql", "0009_reliability_foundation.sql",
    ]) await db.exec(await readFile(path.join(migrations, name), "utf8"));
    const ownerId = "10000000-0000-4000-8000-000000000001";
    const serverId = "20000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'owner_user','Owner')", [ownerId]);
    await db.exec(await readFile(path.join(migrations, "0010_product_depth.sql"), "utf8"));

    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
    );
    const names = new Set(tables.rows.map((row) => row.table_name));
    for (const expected of ["user_privacy_settings", "server_bans", "server_roles", "server_member_roles", "server_audit_log", "message_mentions"]) {
      assert.equal(names.has(expected), true, expected);
    }
    const columns = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='users'",
    );
    assert.equal(columns.rows.some((row) => row.column_name === "deleted_at"), true);
    const sessionColumns = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name='device_sessions'");
    assert.equal(sessionColumns.rows.some((row) => row.column_name === "revoked_reason"), true);
    assert.equal((await db.query("SELECT 1 FROM user_privacy_settings WHERE user_id=$1", [ownerId])).rows.length, 1, "existing users are backfilled");

    await db.query("INSERT INTO servers(id,owner_id,name) VALUES ($1,$2,'Server')", [serverId, ownerId]);
    await db.query("INSERT INTO server_members(server_id,user_id,role) VALUES ($1,$2,'owner')", [serverId, ownerId]);
    await assert.rejects(
      db.query("INSERT INTO server_roles(id,server_id,name,permissions) VALUES ('30000000-0000-4000-8000-000000000001',$1,'Unsafe',ARRAY['administrator']::text[])", [serverId]),
      "unknown permissions are rejected by the database boundary",
    );
  } finally {
    await db.close();
  }
});
