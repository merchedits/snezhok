import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("whole uploads claim one durable receiving lease", async () => {
  const db = new PGlite();
  try {
    const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
    for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(path.join(migrations, file), "utf8"));
    const owner = "10000000-0000-4000-8000-000000000001";
    const upload = "20000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'owner_user','Owner')", [owner]);
    await db.query(`INSERT INTO upload_sessions(id,owner_id,filename,declared_mime_type,declared_bytes,quality,kind,strip_location,temp_key,status,capability_hash,expires_at)
      VALUES ($1,$2,'file.bin','application/octet-stream',4,'original','document',true,'file.upload','receiving',$3,now()+interval '1 hour')`, [upload, owner, "a".repeat(64)]);
    await assert.rejects(db.query(`INSERT INTO upload_sessions(id,owner_id,filename,declared_mime_type,declared_bytes,quality,kind,strip_location,temp_key,status,capability_hash,expires_at)
      VALUES ($1,$2,'other.bin','application/octet-stream',4,'original','document',true,'other.upload','uploading',$3,now()+interval '1 hour')`, ["20000000-0000-4000-8000-000000000002", owner, "a".repeat(64)]));
    await assert.rejects(db.query("UPDATE upload_sessions SET status='unknown' WHERE id=$1", [upload]));
  } finally { await db.close(); }
});
