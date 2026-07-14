import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("hidden messages are private per user and cascade with their message", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrations = path.resolve(here, "../../migrations");
  const db = new PGlite();
  try {
    await db.exec(await readFile(path.join(migrations, "0001_initial.sql"), "utf8"));
    await db.exec(await readFile(path.join(migrations, "0006_hidden_messages.sql"), "utf8"));
    const userId = "00000000-0000-4000-8000-000000000001";
    const messageId = "00000000-0000-4000-8000-000000000002";
    const streamId = "00000000-0000-4000-8000-000000000003";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'hidden_test','Hidden test')", [userId]);
    await db.query(
      "INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind) VALUES ($1,'conversation',$2,1,$3,$1,'text')",
      [messageId, streamId, userId],
    );
    await db.query("INSERT INTO hidden_messages(user_id,message_id) VALUES ($1,$2)", [userId, messageId]);
    await db.query("INSERT INTO hidden_messages(user_id,message_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [userId, messageId]);
    const hidden = await db.query("SELECT 1 FROM hidden_messages WHERE user_id=$1 AND message_id=$2", [userId, messageId]);
    assert.equal(hidden.rows.length, 1);
    await db.query("DELETE FROM messages WHERE id=$1", [messageId]);
    const afterDelete = await db.query("SELECT 1 FROM hidden_messages WHERE user_id=$1", [userId]);
    assert.equal(afterDelete.rows.length, 0);
  } finally {
    await db.close();
  }
});
