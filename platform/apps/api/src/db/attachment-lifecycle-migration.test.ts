import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { attachmentLifecycleUpdateSchema } from "@snezhok/contracts";

test("attachment lifecycle completion is durable and limited to authorized recipients", async () => {
  const db = new PGlite();
  try {
    const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
    for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(migrations, filename), "utf8"));
    }
    const owner = "10000000-0000-4000-8000-000000000001";
    const peer = "10000000-0000-4000-8000-000000000002";
    const outsider = "10000000-0000-4000-8000-000000000003";
    const conversation = "20000000-0000-4000-8000-000000000001";
    const attachment = "30000000-0000-4000-8000-000000000001";
    const message = "40000000-0000-4000-8000-000000000001";
    const blob = "50000000-0000-4000-8000-000000000001";
    await db.query(
      "INSERT INTO users(id,username,display_name) VALUES ($1,'owner_lifecycle','Owner'),($2,'peer_lifecycle','Peer'),($3,'outsider_lifecycle','Outsider')",
      [owner, peer, outsider],
    );
    await db.query("INSERT INTO conversations(id,kind,title,owner_id) VALUES ($1,'direct','',$2)", [conversation, owner]);
    await db.query("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')", [conversation, owner, peer]);
    await db.query("INSERT INTO blobs(id,checksum_sha256,storage_key,bytes,detected_mime_type) VALUES ($1,$2,'objects/lifecycle',10,'image/jpeg')", [blob, "a".repeat(64)]);
    await db.query(
      "INSERT INTO attachments(id,owner_id,blob_id,filename,kind,mime_type,bytes,quality,status) VALUES ($1,$2,$3,'photo.jpg','image','image/jpeg',10,'auto','processing')",
      [attachment, owner, blob],
    );
    await db.query(
      "INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text) VALUES ($1,'conversation',$2,1,$3,'60000000-0000-4000-8000-000000000001','media','')",
      [message, conversation, owner],
    );
    await db.query("INSERT INTO message_attachments(message_id,attachment_id,position) VALUES ($1,$2,0)", [message, attachment]);
    await db.query("UPDATE attachments SET status='ready',width=1200,height=1600,updated_at=now() WHERE id=$1", [attachment]);
    const eventId = (await db.query<{ id: string }>("SELECT publish_attachment_lifecycle($1) id", [attachment])).rows[0]!.id;
    const event = await db.query<{ user_id: string; payload: { id: string; status: string; attachment: { width: number; height: number; status: string } } }>(
      "SELECT user_id::text,payload FROM user_events WHERE event_id=$1 ORDER BY user_id",
      [eventId],
    );
    assert.deepEqual(event.rows.map((row) => row.user_id), [owner, peer]);
    assert.equal(event.rows[0]!.payload.id, attachment);
    assert.equal(event.rows[0]!.payload.status, "ready");
    assert.equal(attachmentLifecycleUpdateSchema.safeParse(event.rows[0]!.payload).success, true);
    assert.deepEqual([event.rows[0]!.payload.attachment.width, event.rows[0]!.payload.attachment.height], [1200, 1600]);
    assert.equal(event.rows[0]!.payload.attachment.status, "ready");
  } finally {
    await db.close();
  }
});

test("attachment lifecycle publisher is a narrow security-definer capability", async () => {
  const migration = await readFile(new URL("../../migrations/0025_attachment_lifecycle_privileges.sql", import.meta.url), "utf8");
  assert.match(migration, /ALTER FUNCTION publish_attachment_lifecycle\(uuid\) SECURITY DEFINER/i);
  assert.match(migration, /SET search_path = pg_catalog, public/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION publish_attachment_lifecycle\(uuid\) FROM PUBLIC/i);
});
