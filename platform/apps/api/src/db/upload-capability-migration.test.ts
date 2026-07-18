import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { capabilityUploadSelectSql } from "../modules/uploads/routes.js";

test("upload capabilities are scoped to an upload and its originating device session", async () => {
  const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
  const db = new PGlite();
  try {
    for (const filename of (await readdir(migrations))
      .filter((name) => name.endsWith(".sql") && name <= "0011_upload_capabilities.sql")
      .sort()) {
      await db.exec(await readFile(path.join(migrations, filename), "utf8"));
    }
    const userId = "10000000-0000-4000-8000-000000000001";
    const sessionId = "20000000-0000-4000-8000-000000000001";
    const uploadId = "30000000-0000-4000-8000-000000000001";
    const capabilityHash = "a".repeat(64);
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'upload_user','Upload')", [userId]);
    await db.query(
      `INSERT INTO device_sessions(id,user_id,label,platform,refresh_token_hash,expires_at)
       VALUES ($1,$2,'Android','android',$3,now()+interval '1 day')`,
      [sessionId, userId, "b".repeat(64)],
    );
    await db.query(
      `INSERT INTO upload_sessions(id,owner_id,filename,declared_mime_type,declared_bytes,quality,kind,temp_key,expires_at,device_session_id,capability_hash)
       VALUES ($1,$2,'photo.jpg','image/jpeg',4,'auto','image',$3,now()+interval '1 hour',$4,$5)`,
      [uploadId, userId, `${uploadId}.upload`, sessionId, capabilityHash],
    );

    const active = await db.query(capabilityUploadSelectSql, [uploadId, capabilityHash]);
    assert.equal(active.rows.length, 1);

    await db.query("UPDATE device_sessions SET revoked_at=now() WHERE id=$1", [sessionId]);
    const revoked = await db.query(capabilityUploadSelectSql, [uploadId, capabilityHash]);
    assert.equal(revoked.rows.length, 0, "revoking the originating device session invalidates its upload capability");

    await assert.rejects(
      db.query(
        `INSERT INTO upload_sessions(id,owner_id,filename,declared_mime_type,declared_bytes,quality,kind,temp_key,expires_at,capability_hash)
         VALUES ('30000000-0000-4000-8000-000000000002',$1,'other.jpg','image/jpeg',4,'auto','image','other.upload',now()+interval '1 hour',$2)`,
        [userId, capabilityHash],
      ),
      /unique|duplicate/i,
    );
  } finally {
    await db.close();
  }
});
