import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import type { DbClient } from "../../db/pool.js";
import { conversationSummaries } from "./service.js";

const viewerId = "10000000-0000-4000-8000-000000000001";
const friendId = "10000000-0000-4000-8000-000000000002";
const thirdId = "10000000-0000-4000-8000-000000000003";
const directId = "20000000-0000-4000-8000-000000000001";
const groupId = "20000000-0000-4000-8000-000000000002";
const visibleMessageId = "30000000-0000-4000-8000-000000000001";
const hiddenMessageId = "30000000-0000-4000-8000-000000000002";

test("conversation bootstrap batches queries while preserving per-recipient hidden and unread state", async () => {
  const db = new PGlite();
  try {
    await applyMigrations(db);
    await seedConversations(db);

    let viewerQueries = 0;
    const viewerClient = countingClient(db, () => { viewerQueries += 1; });
    const viewer = await conversationSummaries(viewerId, viewerClient);

    assert.equal(viewerQueries, 3, "conversation count must not change bootstrap query count");
    assert.equal(viewer.length, 2);
    const direct = viewer.find((item) => item.id === directId);
    assert.ok(direct);
    assert.equal(direct.title, "Friend");
    assert.deepEqual(direct.participants.map((participant) => participant.id), [friendId, viewerId]);
    assert.equal(direct.lastMessage?.id, visibleMessageId, "a hidden newest message must not become this recipient's preview");
    assert.equal(direct.lastMessage?.text, "visible old");
    assert.equal(direct.unreadCount, 1, "hidden and self-authored messages must not count as unread");

    let friendQueries = 0;
    const friend = await conversationSummaries(friendId, countingClient(db, () => { friendQueries += 1; }));
    assert.equal(friendQueries, 3);
    const friendDirect = friend.find((item) => item.id === directId);
    assert.ok(friendDirect);
    assert.equal(friendDirect.title, "Viewer");
    assert.equal(friendDirect.lastMessage?.id, hiddenMessageId, "message hiding is recipient-specific");
    assert.equal(friendDirect.lastMessage?.text, "hidden new");
    assert.equal(friendDirect.unreadCount, 0, "the sender's own messages are never unread");
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

async function seedConversations(db: PGlite): Promise<void> {
  await db.query(
    `INSERT INTO users(id,username,display_name) VALUES
      ($1,'viewer','Viewer'),($2,'friend','Friend'),($3,'third_user','Third')`,
    [viewerId, friendId, thirdId],
  );
  await db.query(
    `INSERT INTO conversations(id,kind,title,owner_id) VALUES
      ($1,'direct','',$3),($2,'group','Group',$3)`,
    [directId, groupId, viewerId],
  );
  await db.query(
    `INSERT INTO conversation_members(conversation_id,user_id,role,pinned_at) VALUES
      ($1,$3,'owner',now()),($1,$4,'member',NULL),
      ($2,$3,'owner',NULL),($2,$5,'member',NULL)`,
    [directId, groupId, viewerId, friendId, thirdId],
  );
  await db.query(
    `INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text,created_at) VALUES
      ($1,'conversation',$3,1,$5,'40000000-0000-4000-8000-000000000001','text','visible old',to_timestamp(1)),
      ($2,'conversation',$3,2,$5,'40000000-0000-4000-8000-000000000002','text','hidden new',to_timestamp(2)),
      ('30000000-0000-4000-8000-000000000003','conversation',$4,1,$6,'40000000-0000-4000-8000-000000000003','text','group visible',to_timestamp(3)),
      ('30000000-0000-4000-8000-000000000004','conversation',$3,3,$5,'40000000-0000-4000-8000-000000000004','text','deleted newest',to_timestamp(4))`,
    [visibleMessageId, hiddenMessageId, directId, groupId, friendId, thirdId],
  );
  await db.query("UPDATE messages SET deleted_at=now() WHERE id='30000000-0000-4000-8000-000000000004'");
  await db.query("INSERT INTO hidden_messages(user_id,message_id) VALUES ($1,$2)", [viewerId, hiddenMessageId]);
  await db.query(
    "INSERT INTO message_reactions(message_id,user_id,emoji) VALUES ($1,$2,'heart'),($1,$3,'heart')",
    [visibleMessageId, viewerId, friendId],
  );
}

function countingClient(db: PGlite, increment: () => void): Pick<DbClient, "query"> {
  return {
    query: (async (text: string, values?: unknown[]) => {
      increment();
      return db.query(text, values);
    }) as DbClient["query"],
  };
}
