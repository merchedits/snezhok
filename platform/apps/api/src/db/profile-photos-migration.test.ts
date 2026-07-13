import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("profile photo migration preserves the active avatar and ordered history", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrations = path.resolve(here, "../../migrations");
  const db = new PGlite();
  try {
    await db.exec(await readFile(path.join(migrations, "0001_initial.sql"), "utf8"));
    await db.exec(await readFile(path.join(migrations, "0002_media_pipeline.sql"), "utf8"));
    const userId = "00000000-0000-4000-8000-000000000001";
    const attachmentId = "00000000-0000-4000-8000-000000000002";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'existing','Existing')", [userId]);
    await db.query(
      "INSERT INTO blobs(id,checksum_sha256,storage_key,bytes,detected_mime_type) VALUES ($1,$2,'objects/avatar.jpg',4,'image/jpeg')",
      ["00000000-0000-4000-8000-000000000003", "a".repeat(64)],
    );
    await db.query(
      "INSERT INTO attachments(id,owner_id,blob_id,filename,kind,mime_type,bytes,quality,status) VALUES ($1,$2,$3,'avatar.jpg','image','image/jpeg',4,'high','ready')",
      [attachmentId, userId, "00000000-0000-4000-8000-000000000003"],
    );
    await db.query("UPDATE users SET avatar_attachment_id=$2 WHERE id=$1", [userId, attachmentId]);
    await db.exec(await readFile(path.join(migrations, "0004_profile_photos.sql"), "utf8"));
    const columns = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name='user_profile_photos'");
    for (const expected of ["user_id", "attachment_id", "position", "created_at"]) {
      assert.ok(columns.rows.some((row) => row.column_name === expected));
    }
    const index = await db.query("SELECT 1 FROM pg_indexes WHERE indexname='user_profile_photos_attachment_idx'");
    assert.equal(index.rows.length, 1);
    const active = await db.query<{ attachment_id: string; position: number }>("SELECT attachment_id,position FROM user_profile_photos WHERE user_id=$1", [userId]);
    assert.deepEqual(active.rows, [{ attachment_id: attachmentId, position: 0 }]);
  } finally {
    await db.close();
  }
});
