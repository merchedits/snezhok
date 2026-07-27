import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import { attachmentAuthorizationSql, fileLookupSql } from "./routes.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const viewerId = "10000000-0000-4000-8000-000000000002";
const outsiderId = "10000000-0000-4000-8000-000000000003";
const conversationId = "20000000-0000-4000-8000-000000000001";
const forwardedConversationId = "20000000-0000-4000-8000-000000000002";
const attachmentId = "30000000-0000-4000-8000-000000000001";
const profileAttachmentId = "30000000-0000-4000-8000-000000000002";
const messageId = "40000000-0000-4000-8000-000000000001";
const forwardedMessageId = "40000000-0000-4000-8000-000000000002";

test("file authorization excludes deleted/hidden links and enforces profile-photo privacy", async () => {
  const db = new PGlite();
  try {
    await applyMigrations(db);
    await seed(db);

    assert.equal(await allowed(db, ownerId, attachmentId), true, "an owner retains access to an uploaded object");
    assert.equal(await allowed(db, viewerId, attachmentId), true, "an active visible message authorizes its stream member");
    assert.equal(await allowed(db, outsiderId, attachmentId), false, "stream membership is required");

    await db.query("INSERT INTO hidden_messages(user_id,message_id) VALUES ($1,$2)", [viewerId, messageId]);
    assert.equal(await allowed(db, viewerId, attachmentId), false, "a hidden message cannot authorize its attachment for that user");
    assert.equal(await allowed(db, ownerId, attachmentId), true, "recipient hiding does not revoke the attachment owner");

    await db.query("DELETE FROM hidden_messages WHERE user_id=$1 AND message_id=$2", [viewerId, messageId]);
    await db.query("UPDATE messages SET deleted_at=now() WHERE id=$1", [messageId]);
    assert.equal(await allowed(db, viewerId, attachmentId), false, "a deleted message cannot authorize an attachment");

    await db.query(
      "INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text,forwarded_from_id) VALUES ($1,'conversation',$2,1,$3,$4,'media','',$5)",
      [forwardedMessageId, forwardedConversationId, ownerId, "50000000-0000-4000-8000-000000000002", messageId],
    );
    await db.query("INSERT INTO message_attachments(message_id,attachment_id,position) VALUES ($1,$2,0)", [forwardedMessageId, attachmentId]);
    assert.equal(await allowed(db, viewerId, attachmentId), true, "an active forwarded copy remains a valid authorization link");

    assert.equal(await allowed(db, outsiderId, profileAttachmentId), true, "active profile photos are visible to authenticated users");

    await db.query("UPDATE user_privacy_settings SET profile_photos='contacts' WHERE user_id=$1", [ownerId]);
    assert.equal(await allowed(db, outsiderId, profileAttachmentId), false, "contacts-only photos reject non-contacts");
    await db.query("INSERT INTO friendships(user_low_id,user_high_id) VALUES (LEAST($1::uuid,$2::uuid),GREATEST($1::uuid,$2::uuid))", [ownerId, outsiderId]);
    assert.equal(await allowed(db, outsiderId, profileAttachmentId), true, "contacts-only photos permit contacts");
    await db.query("INSERT INTO user_blocks(blocker_id,blocked_id) VALUES ($1,$2)", [ownerId, outsiderId]);
    assert.equal(await allowed(db, outsiderId, profileAttachmentId), false, "a bilateral block takes precedence over friendship and privacy audience");
    assert.equal(await allowed(db, ownerId, profileAttachmentId), true, "the attachment owner always retains access");

    const file = await db.query<{ filename: string; allowed: boolean }>(fileLookupSql, [attachmentId, ownerId, null]);
    assert.equal(file.rows[0]?.filename, "message.jpg");
    assert.equal(file.rows[0]?.allowed, true, "the production file lookup must parse and preserve access decisions");
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
  await db.query(
    `INSERT INTO users(id,username,display_name) VALUES
      ($1,'owner_user','Owner'),($2,'viewer_user','Viewer'),($3,'outsider_user','Outsider')`,
    [ownerId, viewerId, outsiderId],
  );
  await db.query("INSERT INTO user_privacy_settings(user_id) VALUES ($1),($2),($3)", [ownerId, viewerId, outsiderId]);
  await db.query(
    `INSERT INTO blobs(id,checksum_sha256,storage_key,bytes,detected_mime_type) VALUES
      ('60000000-0000-4000-8000-000000000001',$1,'objects/aa/'||$1,4,'image/jpeg'),
      ('60000000-0000-4000-8000-000000000002',$2,'objects/bb/'||$2,4,'image/jpeg')`,
    ["a".repeat(64), "b".repeat(64)],
  );
  await db.query(
    `INSERT INTO attachments(id,owner_id,blob_id,filename,kind,mime_type,bytes,quality,status) VALUES
      ($1,$3,'60000000-0000-4000-8000-000000000001','message.jpg','image','image/jpeg',4,'auto','ready'),
      ($2,$3,'60000000-0000-4000-8000-000000000002','profile.jpg','image','image/jpeg',4,'auto','ready')`,
    [attachmentId, profileAttachmentId, ownerId],
  );
  await db.query("INSERT INTO user_profile_photos(user_id,attachment_id,position) VALUES ($1,$2,0)", [ownerId, profileAttachmentId]);
  await db.query(
    `INSERT INTO conversations(id,kind,title,owner_id) VALUES
      ($1,'direct','',$3),($2,'direct','',$3)`,
    [conversationId, forwardedConversationId, ownerId],
  );
  await db.query(
    `INSERT INTO conversation_members(conversation_id,user_id,role) VALUES
      ($1,$3,'owner'),($1,$4,'member'),($2,$3,'owner'),($2,$4,'member')`,
    [conversationId, forwardedConversationId, ownerId, viewerId],
  );
  await db.query(
    "INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text) VALUES ($1,'conversation',$2,1,$3,$4,'media','')",
    [messageId, conversationId, ownerId, "50000000-0000-4000-8000-000000000001"],
  );
  await db.query("INSERT INTO message_attachments(message_id,attachment_id,position) VALUES ($1,$2,0)", [messageId, attachmentId]);
}

async function allowed(db: PGlite, userId: string, requestedAttachmentId: string): Promise<boolean> {
  const result = await db.query<{ allowed: boolean }>(attachmentAuthorizationSql, [requestedAttachmentId, userId]);
  return result.rows[0]?.allowed === true;
}
