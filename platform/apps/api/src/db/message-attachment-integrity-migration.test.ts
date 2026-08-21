import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("database rejects a transport attachment linked to the wrong message kind", async () => {
  const db = new PGlite();
  try {
    const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
    for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(migrations, filename), "utf8"));
    }
    const owner = "10000000-0000-4000-8000-000000000001";
    const conversation = "20000000-0000-4000-8000-000000000001";
    const message = "30000000-0000-4000-8000-000000000001";
    const attachment = "40000000-0000-4000-8000-000000000001";
    const blob = "50000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'shape_owner','Owner')", [owner]);
    await db.query("INSERT INTO conversations(id,kind,title,owner_id) VALUES ($1,'direct','',$2)", [conversation, owner]);
    await db.query("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES ($1,$2,'owner')", [conversation, owner]);
    await db.query("INSERT INTO blobs(id,checksum_sha256,storage_key,bytes,detected_mime_type) VALUES ($1,$2,'objects/shape',10,'image/jpeg')", [blob, "a".repeat(64)]);
    await db.query("INSERT INTO attachments(id,owner_id,blob_id,filename,kind,mime_type,bytes,quality,status) VALUES ($1,$2,$3,'photo.jpg','image','image/jpeg',10,'auto','ready')", [attachment, owner, blob]);
    await assert.rejects(
      db.query("INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text) VALUES ('30000000-0000-4000-8000-000000000002','conversation',$1,2,$2,'60000000-0000-4000-8000-000000000002','media','')", [conversation, owner]),
      /invalid attachment shape/,
    );
    await db.query("INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text) VALUES ($1,'conversation',$2,1,$3,$4,'text','hello')", [message, conversation, owner, "60000000-0000-4000-8000-000000000001"]);
    await assert.rejects(
      db.query("INSERT INTO message_attachments(message_id,attachment_id,position) VALUES ($1,$2,0)", [message, attachment]),
      /invalid attachment shape/,
    );
    const audit = await db.query("SELECT * FROM invalid_message_attachment_shapes");
    assert.equal(audit.rows.length, 0);
  } finally {
    await db.close();
  }
});
