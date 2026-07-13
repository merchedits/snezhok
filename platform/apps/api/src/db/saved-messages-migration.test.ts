import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("saved messages migration provisions one pinned private stream per existing user", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrations = path.resolve(here, "../../migrations");
  const db = new PGlite();
  try {
    await db.exec(await readFile(path.join(migrations, "0001_initial.sql"), "utf8"));
    const userId = "00000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'existing','Existing')", [userId]);
    await db.exec(await readFile(path.join(migrations, "0005_saved_messages_forwarding.sql"), "utf8"));

    const saved = await db.query<{ id: string; owner_id: string; saved_owner_id: string; member_id: string; pinned: boolean }>(
      `SELECT c.id,c.owner_id,c.saved_owner_id,cm.user_id member_id,cm.pinned_at IS NOT NULL pinned
       FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.saved_owner_id=$1`,
      [userId],
    );
    assert.equal(saved.rows.length, 1);
    assert.equal(saved.rows[0]?.owner_id, userId);
    assert.equal(saved.rows[0]?.member_id, userId);
    assert.equal(saved.rows[0]?.pinned, true);
    assert.match(saved.rows[0]!.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);

    await assert.rejects(db.query("INSERT INTO conversations(id,kind,title,owner_id,saved_owner_id) VALUES ($1,'group','',$2,$2)", ["00000000-0000-4000-8000-000000000009", userId]));
    const forwardColumn = await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='forwarded_from_id'");
    assert.equal(forwardColumn.rows.length, 1);
  } finally {
    await db.close();
  }
});
