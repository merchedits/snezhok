import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { activeCallSql, claimJobSql, pool } from "./database.js";

test("media work ignores abandoned call sessions after the configured window", () => {
  assert.match(activeCallSql, /started_at\s*>=\s*now\(\)-\(\$1::text\s*\|\|\s*' hours'\)::interval/i);
});

test("media storage accepts legacy and generation-keyed immutable objects", async () => {
  const { objectPath } = await import("./storage.js");
  const checksum = "a".repeat(64);
  assert.match(objectPath(`objects/aa/${checksum}`), new RegExp(`${checksum}$`));
  assert.match(objectPath(`objects/aa/${checksum}-00000000-0000-4000-8000-000000000001`), /000000000001$/);
  assert.throws(() => objectPath(`objects/aa/${checksum}-..`), /Invalid content-addressed storage key/);
});

test("SKIP LOCKED claim atomically leases one eligible media job", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url)); const migrations = path.resolve(here, "../../api/migrations");
  const db = new PGlite();
  try {
    await db.exec(await readFile(path.join(migrations, "0001_initial.sql"), "utf8"));
    await db.exec(await readFile(path.join(migrations, "0002_media_pipeline.sql"), "utf8"));
    await db.exec(await readFile(path.join(migrations, "0019_activity_collages.sql"), "utf8"));
    const user = "00000000-0000-4000-8000-000000000001"; const blob = "00000000-0000-4000-8000-000000000002";
    const attachment = "00000000-0000-4000-8000-000000000003"; const job = "00000000-0000-4000-8000-000000000004";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'worker_test','Worker Test')", [user]);
    await db.query("INSERT INTO blobs(id,checksum_sha256,storage_key,bytes,detected_mime_type) VALUES ($1,$2,$3,10,'image/jpeg')", [blob, "a".repeat(64), `objects/aa/${"a".repeat(64)}`]);
    await db.query("INSERT INTO attachments(id,owner_id,blob_id,filename,kind,mime_type,bytes,quality) VALUES ($1,$2,$3,'photo.jpg','image','image/jpeg',10,'auto')", [attachment, user, blob]);
    await db.query("INSERT INTO media_jobs(id,attachment_id,profile) VALUES ($1,$2,'auto')", [job, attachment]);
    const claimed = await db.query<{ id: string; attempts: number; purpose: string }>(claimJobSql, ["test-worker"]);
    assert.equal(claimed.rows.length, 1); assert.equal(claimed.rows[0]!.id, job); assert.equal(claimed.rows[0]!.attempts, 1); assert.equal(claimed.rows[0]!.purpose, "standard");
    const second = await db.query(claimJobSql, ["test-worker"]); assert.equal(second.rows.length, 0);
  } finally { await db.close(); await pool.end(); }
});
