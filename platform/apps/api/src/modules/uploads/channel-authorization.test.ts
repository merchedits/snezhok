import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import { attachmentAuthorizationSql } from "./routes.js";

test("channel attachment authorization applies the final view_channels override", async () => {
  const db = new PGlite();
  try {
    const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../migrations");
    for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(migrations, filename), "utf8"));
    }
    const ownerId = "10000000-0000-4000-8000-000000000001";
    const viewerId = "10000000-0000-4000-8000-000000000002";
    const serverId = "20000000-0000-4000-8000-000000000001";
    const channelId = "30000000-0000-4000-8000-000000000001";
    const attachmentId = "40000000-0000-4000-8000-000000000001";
    const messageId = "50000000-0000-4000-8000-000000000001";
    await db.query(
      "INSERT INTO users(id,username,display_name) VALUES ($1,'media_owner','Owner'),($2,'media_viewer','Viewer')",
      [ownerId, viewerId],
    );
    await db.query("INSERT INTO servers(id,owner_id,name) VALUES ($1,$2,'Server')", [serverId, ownerId]);
    await db.query(
      "INSERT INTO server_members(server_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')",
      [serverId, ownerId, viewerId],
    );
    await db.query("INSERT INTO channels(id,server_id,kind,name) VALUES ($1,$2,'text','media')", [channelId, serverId]);
    await db.query(
      "INSERT INTO blobs(id,checksum_sha256,storage_key,bytes,detected_mime_type) VALUES ('60000000-0000-4000-8000-000000000001',$1,'objects/channel-test',4,'image/jpeg')",
      ["d".repeat(64)],
    );
    await db.query(
      `INSERT INTO attachments(id,owner_id,blob_id,filename,kind,mime_type,bytes,quality,status)
       VALUES ($1,$2,'60000000-0000-4000-8000-000000000001','channel.jpg','image','image/jpeg',4,'auto','ready')`,
      [attachmentId, ownerId],
    );
    await db.query("BEGIN");
    await db.query(
      `INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text)
       VALUES ($1,'channel',$2,1,$3,'70000000-0000-4000-8000-000000000001','media','')`,
      [messageId, channelId, ownerId],
    );
    await db.query("INSERT INTO message_attachments(message_id,attachment_id,position) VALUES ($1,$2,0)", [messageId, attachmentId]);
    await db.query("COMMIT");

    assert.equal(await allowed(db, attachmentId, viewerId), true);
    await db.query(
      "INSERT INTO channel_everyone_permission_overrides(channel_id,deny_permissions) VALUES ($1,ARRAY['view_channels']::text[])",
      [channelId],
    );
    assert.equal(await allowed(db, attachmentId, viewerId), false, "an everyone denial must prevent direct file access");
    await db.query(
      "INSERT INTO channel_member_permission_overrides(channel_id,user_id,allow_permissions) VALUES ($1,$2,ARRAY['view_channels']::text[])",
      [channelId, viewerId],
    );
    assert.equal(await allowed(db, attachmentId, viewerId), true, "the final member allow wins over an everyone denial");
  } finally {
    await db.close();
  }
});

async function allowed(db: PGlite, attachmentId: string, userId: string) {
  const result = await db.query<{ allowed: boolean }>(attachmentAuthorizationSql, [attachmentId, userId]);
  return result.rows[0]?.allowed === true;
}
