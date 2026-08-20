import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("message and reaction mutations advance one monotonic durable revision", async () => {
  const db = new PGlite();
  try {
    const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
    for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(migrations, filename), "utf8"));
    }
    const sender = "10000000-0000-4000-8000-000000000001";
    const reactor = "10000000-0000-4000-8000-000000000002";
    const conversation = "20000000-0000-4000-8000-000000000001";
    const message = "30000000-0000-4000-8000-000000000001";
    await db.query(
      "INSERT INTO users(id,username,display_name) VALUES ($1,'revision_sender','Sender'),($2,'revision_peer','Peer')",
      [sender, reactor],
    );
    await db.query("INSERT INTO conversations(id,kind,title,owner_id) VALUES ($1,'direct','',$2)", [conversation, sender]);
    await db.query("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')", [conversation, sender, reactor]);
    await db.query(
      "INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text) VALUES ($1,'conversation',$2,1,$3,$4,'text','first')",
      [message, conversation, sender, "40000000-0000-4000-8000-000000000001"],
    );
    assert.equal(await revision(db, message), 1);
    await db.query("UPDATE messages SET text='edited',edited_at=now() WHERE id=$1", [message]);
    assert.equal(await revision(db, message), 2);
    await db.query("INSERT INTO message_reactions(message_id,user_id,emoji) VALUES ($1,$2,'heart')", [message, reactor]);
    assert.equal(await revision(db, message), 3);
    await db.query("DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji='heart'", [message, reactor]);
    assert.equal(await revision(db, message), 4);
  } finally {
    await db.close();
  }
});

async function revision(db: PGlite, messageId: string): Promise<number> {
  const result = await db.query<{ revision: string }>("SELECT revision::text FROM messages WHERE id=$1", [messageId]);
  return Number(result.rows[0]!.revision);
}
