import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import type { DbClient } from "../../db/pool.js";
import { notificationPolicyForEvent } from "./push.js";

const userId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const serverId = "30000000-0000-4000-8000-000000000001";
const channelId = "40000000-0000-4000-8000-000000000001";

test("push policy combines global, per-stream, conversation, and server mute state", async () => {
  const db = new PGlite();
  try {
    await applyMigrations(db);
    await seed(db);
    const client = db as unknown as Pick<DbClient, "query">;

    const directMuted = await notificationPolicyForEvent(userId, "message:created", stream("conversation", conversationId), client);
    assert.deepEqual(directMuted, { enabled: false, language: "en", showPreview: false, sound: true });

    await db.query("UPDATE conversation_members SET muted_until=NULL WHERE user_id=$1 AND conversation_id=$2", [userId, conversationId]);
    await db.query(
      "INSERT INTO stream_notification_settings(user_id,stream_kind,stream_id,enabled,show_preview) VALUES ($1,'conversation',$2,false,true)",
      [userId, conversationId],
    );
    const directDisabled = await notificationPolicyForEvent(userId, "message:created", stream("conversation", conversationId), client);
    assert.deepEqual(directDisabled, { enabled: false, language: "en", showPreview: true, sound: true });

    const serverMuted = await notificationPolicyForEvent(userId, "message:created", stream("channel", channelId), client);
    assert.equal(serverMuted.enabled, false);

    await db.query("UPDATE server_members SET muted_until=NULL WHERE user_id=$1 AND server_id=$2", [userId, serverId]);
    const channelEnabled = await notificationPolicyForEvent(userId, "message:created", stream("channel", channelId), client);
    assert.deepEqual(channelEnabled, { enabled: true, language: "en", showPreview: false, sound: true });

    await db.query("UPDATE user_settings SET settings=settings||'{\"callNotifications\":false}'::jsonb WHERE user_id=$1", [userId]);
    const dismissal = await notificationPolicyForEvent(userId, "call:updated", { ...stream("channel", channelId), state: "ended" }, client);
    assert.deepEqual(dismissal, { enabled: true, language: "en", showPreview: false, sound: false }, "call dismissal must clear an already visible notification");
  } finally {
    await db.close();
  }
});

function stream(streamKind: "conversation" | "channel", streamId: string) {
  return { streamKind, streamId };
}

async function applyMigrations(db: PGlite): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrations = path.resolve(here, "../../../migrations");
  for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(migrations, filename), "utf8"));
  }
}

async function seed(db: PGlite): Promise<void> {
  await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'policy_user','Policy')", [userId]);
  await db.query("INSERT INTO user_settings(user_id,settings) VALUES ($1,$2)", [userId, { language: "en", notificationPreviews: false }]);
  await db.query("INSERT INTO conversations(id,kind,title,owner_id) VALUES ($1,'direct','',$2)", [conversationId, userId]);
  await db.query("INSERT INTO conversation_members(conversation_id,user_id,role,muted_until) VALUES ($1,$2,'owner',now()+interval '1 hour')", [conversationId, userId]);
  await db.query("INSERT INTO servers(id,owner_id,name) VALUES ($1,$2,'Server')", [serverId, userId]);
  await db.query("INSERT INTO server_members(server_id,user_id,role,muted_until) VALUES ($1,$2,'owner',now()+interval '1 hour')", [serverId, userId]);
  await db.query("INSERT INTO channels(id,server_id,kind,name) VALUES ($1,$2,'text','general')", [channelId, serverId]);
}
