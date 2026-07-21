import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { presenceRecipientsSql } from "./socket.js";

test("presence recipients exclude deleted and bilaterally blocked peers", async () => {
  const db = new PGlite();
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const migrations = path.resolve(here, "../../../migrations");
    for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(path.join(migrations, file), "utf8"));
    const a = "10000000-0000-4000-8000-000000000001";
    const b = "10000000-0000-4000-8000-000000000002";
    const c = "10000000-0000-4000-8000-000000000003";
    const d = "10000000-0000-4000-8000-000000000004";
    const server = "20000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'alpha_user','Alpha'),($2,'beta_user','Beta'),($3,'gamma_user','Gamma'),($4,'server_peer','Server peer')", [a, b, c, d]);
    await db.query("INSERT INTO friendships(user_low_id,user_high_id) VALUES ($1,$2),($1,$3)", [a, b, c]);
    await db.query("INSERT INTO servers(id,owner_id,name) VALUES ($1,$2,'Shared')", [server, a]);
    await db.query("INSERT INTO server_members(server_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')", [server, a, d]);
    let rows = await db.query<{ user_id: string }>(presenceRecipientsSql, [a]);
    assert.deepEqual(new Set(rows.rows.map((row) => row.user_id)), new Set([b, c]));
    await db.query("INSERT INTO user_blocks(blocker_id,blocked_id) VALUES ($1,$2)", [b, a]);
    await db.query("UPDATE users SET deleted_at=now() WHERE id=$1", [c]);
    rows = await db.query<{ user_id: string }>(presenceRecipientsSql, [a]);
    assert.deepEqual(rows.rows, []);
  } finally { await db.close(); }
});
