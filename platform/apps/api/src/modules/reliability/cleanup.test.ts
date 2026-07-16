import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import type { DbClient } from "../../db/pool.js";
import { cleanupReliabilityData } from "./cleanup.js";

const userId = "10000000-0000-4000-8000-000000000001";

test("maintenance advances replay watermarks and removes attachments without racing immutable blob storage", async () => {
  const db = new PGlite();
  try {
    await applyMigrations(db);
    await seed(db);
    const result = await cleanupReliabilityData(db as unknown as Pick<DbClient, "query">, {
      eventRetentionDays: 30,
      orphanMediaRetentionDays: 7,
      pushRetentionDays: 7,
      batchSize: 100,
    });

    assert.equal(result.prunedUserEvents, 1);
    assert.equal(result.prunedEvents, 1);
    assert.equal(result.expiredUploads, 1);
    assert.equal(result.detachedDeletedMessageFiles, 1);
    assert.equal(result.deletedAttachments, 2, "unattached and deleted-message-only attachments are collectible");
    assert.equal(result.deletedBlobs, 0, "live maintenance must not unlink content-addressed objects without coordinated storage GC");
    assert.deepEqual(result.temporaryKeys, ["expired.upload"]);

    const watermark = await db.query<{ discarded_through_cursor: string }>(
      "SELECT discarded_through_cursor::text FROM event_retention_watermarks WHERE user_id=$1",
      [userId],
    );
    assert.ok(Number(watermark.rows[0]?.discarded_through_cursor) > 0);
    const attachmentIds = await db.query<{ id: string }>("SELECT id FROM attachments ORDER BY id");
    assert.deepEqual(attachmentIds.rows.map((row) => row.id), ["30000000-0000-4000-8000-000000000002"], "an active message reference must preserve its attachment");
    const blobIds = await db.query<{ id: string }>("SELECT id FROM blobs ORDER BY id");
    assert.equal(blobIds.rows.length, 3, "immutable blobs stay available until the coordinated collector owns their lifecycle");
  } finally {
    await db.close();
  }
});

async function applyMigrations(db: PGlite): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrations = path.resolve(here, "../../../migrations");
  for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(migrations, filename), "utf8"));
  }
}

async function seed(db: PGlite): Promise<void> {
  await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'cleanup_user','Cleanup')", [userId]);
  await db.query(
    "INSERT INTO events(id,name,payload,created_at) VALUES ($1,'old:event','{}',now()-interval '40 days'),($2,'new:event','{}',now())",
    ["20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002"],
  );
  await db.query(
    "INSERT INTO user_events(user_id,event_id,payload) VALUES ($1,$2,'{}'),($1,$3,'{}')",
    [userId, "20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002"],
  );
  await db.query(
    `INSERT INTO upload_sessions(id,owner_id,filename,declared_mime_type,declared_bytes,quality,kind,strip_location,temp_key,status,expires_at)
     VALUES ($1,$2,'expired.bin','application/octet-stream',4,'auto','document',true,'expired.upload','uploading',now()-interval '1 day')`,
    ["70000000-0000-4000-8000-000000000001", userId],
  );
  await db.query(
    `INSERT INTO blobs(id,checksum_sha256,storage_key,bytes,detected_mime_type,created_at) VALUES
      ('40000000-0000-4000-8000-000000000001',$1,'objects/aa/'||$1,4,'image/jpeg',now()-interval '10 days'),
      ('40000000-0000-4000-8000-000000000002',$2,'objects/bb/'||$2,4,'image/jpeg',now()-interval '10 days'),
      ('40000000-0000-4000-8000-000000000003',$3,'objects/cc/'||$3,4,'image/jpeg',now()-interval '10 days')`,
    ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
  );
  await db.query(
    `INSERT INTO attachments(id,owner_id,blob_id,filename,kind,mime_type,bytes,quality,status,created_at) VALUES
      ('30000000-0000-4000-8000-000000000001',$1,'40000000-0000-4000-8000-000000000001','orphan.jpg','image','image/jpeg',4,'auto','ready',now()-interval '10 days'),
      ('30000000-0000-4000-8000-000000000002',$1,'40000000-0000-4000-8000-000000000002','active.jpg','image','image/jpeg',4,'auto','ready',now()-interval '10 days'),
      ('30000000-0000-4000-8000-000000000003',$1,'40000000-0000-4000-8000-000000000003','deleted.jpg','image','image/jpeg',4,'auto','ready',now()-interval '10 days')`,
    [userId],
  );
  const conversationId = "50000000-0000-4000-8000-000000000001";
  await db.query("INSERT INTO conversations(id,kind,title,owner_id) VALUES ($1,'direct','',$2)", [conversationId, userId]);
  await db.query("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES ($1,$2,'owner')", [conversationId, userId]);
  await db.query(
    `INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text,deleted_at) VALUES
      ('60000000-0000-4000-8000-000000000001','conversation',$1,1,$2,'80000000-0000-4000-8000-000000000001','media','',NULL),
      ('60000000-0000-4000-8000-000000000002','conversation',$1,2,$2,'80000000-0000-4000-8000-000000000002','media','',now()-interval '8 days')`,
    [conversationId, userId],
  );
  await db.query(
    `INSERT INTO message_attachments(message_id,attachment_id,position) VALUES
      ('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',0),
      ('60000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003',0)`,
  );
}
