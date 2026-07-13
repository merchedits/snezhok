import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "../db/migrate.js";
import { pool, transaction, type DbClient } from "../db/pool.js";
import { deterministicId, newId } from "../lib/ids.js";
import { defaultSettings } from "../modules/settings/defaults.js";
import { ensureStorage, finalizeObject, tempPath } from "../modules/uploads/storage.js";
import { orderedPair } from "../modules/friends/service.js";
import { safeLegacyFile } from "../lib/legacy-files.js";

interface LegacyUser { id: string; username: string; password_hash: string; display_name: string; avatar_color: string; avatar_url: string | null; bio?: string; custom_status?: string; is_admin: number; created_at: number; last_seen_at: number; }
interface LegacyFile { id: string; user_id: string; original_name: string; stored_name: string; mime_type: string; size_bytes: number; created_at: number; }
interface LegacyConversation { id: string; type: string; name?: string | null; owner_id?: string | null; created_at: number; updated_at?: number; }
interface LegacyMember { conversation_id: string; user_id: string; role?: string; last_read_at?: number; muted_until?: number | null; joined_at: number; }
interface LegacyMessage { id: string; conversation_id?: string; user_id: string; content: string; type: string; file_id: string | null; reply_to_id: string | null; created_at: number; edited_at: number | null; pinned_at?: number | null; pinned_by?: string | null; }

const args = parseArgs(process.argv.slice(2));
if (!args.database || !args.uploads) {
  console.error("Usage: npm run import:legacy -- --database /path/snezhok.db --uploads /path/uploads");
  process.exitCode = 2;
} else {
  await migrate(); await ensureStorage();
  const sqlite = new Database(args.database, { readonly: true, fileMustExist: true });
  sqlite.pragma("query_only = ON");
  sqlite.exec("BEGIN");
  try {
    const report = await importLegacy(sqlite, path.resolve(args.uploads));
    sqlite.exec("COMMIT");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  } finally {
    sqlite.close(); await pool.end();
  }
}

async function importLegacy(sqlite: Database.Database, uploadsRoot: string) {
  const users = all<LegacyUser>(sqlite, "users");
  const files = all<LegacyFile>(sqlite, "files");
  const conversations = all<LegacyConversation>(sqlite, "conversations");
  const members = all<LegacyMember>(sqlite, "conversation_members");
  const messages = all<LegacyMessage>(sqlite, "messages").sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  const reactions = all<{ id: string; message_id: string; user_id: string; emoji: string; created_at: number }>(sqlite, "reactions");
  const friendships = all<{ id: string; user_a_id: string; user_b_id: string; created_at: number }>(sqlite, "friendships");
  const requests = all<{ id: string; sender_id: string; receiver_id: string; status: string; created_at: number; responded_at: number | null }>(sqlite, "friend_requests");

  const owner = users.find((user) => user.is_admin) ?? users[0];
  if (!owner) return { users: 0, messages: 0, files: 0, warning: "Legacy database contains no users" };
  const defaultServerId = deterministicId("legacy-server", "default");
  const generalChannelId = deterministicId("legacy-channel", "general");
  const fileMap = new Map<string, string>();
  const missingFiles: string[] = [];

  await transaction(async (client) => {
    for (const user of users) {
      const id = userId(user.id);
      await client.query(
        `INSERT INTO users(id,username,display_name,avatar_color,bio,status_text,is_admin,last_seen_at,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0),to_timestamp($9/1000.0),to_timestamp($9/1000.0)) ON CONFLICT (id) DO NOTHING`,
        [id, user.username.toLowerCase(), user.display_name, user.avatar_color, user.bio ?? "", user.custom_status ?? "", Boolean(user.is_admin), user.last_seen_at, user.created_at]);
      await client.query("INSERT INTO credentials(user_id,password_hash,algorithm) VALUES ($1,$2,'bcrypt') ON CONFLICT (user_id) DO NOTHING", [id, user.password_hash]);
      await client.query("INSERT INTO user_settings(user_id,settings) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING", [id, defaultSettings]);
      await mapLegacy(client, "user", user.id, id);
    }
  });

  for (const file of files) {
    const source = await safeLegacyFile(uploadsRoot, file.stored_name);
    if (!source) { missingFiles.push(file.stored_name); continue; }
    const tempKey = `legacy-${deterministicId("legacy-temp", file.id)}.upload`;
    await mkdir(path.dirname(tempPath(tempKey)), { recursive: true }); await copyFile(source, tempPath(tempKey));
    const object = await finalizeObject(tempKey); const attachmentId = deterministicId("legacy-attachment", file.id); fileMap.set(file.id, attachmentId);
    await transaction(async (client) => {
      const blobId = await upsertBlob(client, object);
      await client.query(
        `INSERT INTO attachments(id,owner_id,blob_id,filename,kind,mime_type,bytes,quality,status,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'original','ready',to_timestamp($8/1000.0)) ON CONFLICT (id) DO NOTHING`,
        [attachmentId, userId(file.user_id), blobId, file.original_name, attachmentKind(object.detectedMimeType), object.detectedMimeType, object.bytes, file.created_at]);
      await mapLegacy(client, "file", file.id, attachmentId);
    });
  }

  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [981_734_204]);
    for (const user of users) {
      const id = userId(user.id);
      await client.query(
        `INSERT INTO users(id,username,display_name,avatar_color,bio,status_text,is_admin,last_seen_at,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0),to_timestamp($9/1000.0),to_timestamp($9/1000.0))
         ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name,bio=EXCLUDED.bio,status_text=EXCLUDED.status_text,last_seen_at=EXCLUDED.last_seen_at`,
        [id, user.username.toLowerCase(), user.display_name, user.avatar_color, user.bio ?? "", user.custom_status ?? "", Boolean(user.is_admin), user.last_seen_at, user.created_at]);
      await client.query("INSERT INTO credentials(user_id,password_hash,algorithm) VALUES ($1,$2,'bcrypt') ON CONFLICT (user_id) DO NOTHING", [id, user.password_hash]);
      await client.query("INSERT INTO user_settings(user_id,settings) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING", [id, defaultSettings]);
      await mapLegacy(client, "user", user.id, id);
    }
    const ownerId = userId(owner.id);
    await client.query(
      `INSERT INTO servers(id,owner_id,name,created_at,updated_at) VALUES ($1,$2,'Migrated',now(),now())
       ON CONFLICT (id) DO UPDATE SET owner_id=EXCLUDED.owner_id`, [defaultServerId, ownerId]);
    for (const user of users) await client.query(
      `INSERT INTO server_members(server_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (server_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
      [defaultServerId, userId(user.id), user.id === owner.id ? "owner" : "member"]);
    await client.query(
      `INSERT INTO channels(id,server_id,kind,name,topic,position) VALUES ($1,$2,'text','general','Migrated from the original global chat',0)
       ON CONFLICT (id) DO NOTHING`, [generalChannelId, defaultServerId]);
    await mapLegacy(client, "conversation", "global", generalChannelId);

    for (const conversation of conversations.filter((item) => item.id !== "global")) {
      const id = conversationId(conversation.id); const conversationMembers = members.filter((member) => member.conversation_id === conversation.id);
      const kind = conversation.type === "group" || conversationMembers.length > 2 ? "group" : "direct";
      const ownerLegacyId = conversation.owner_id ?? conversationMembers[0]?.user_id ?? owner.id;
      await client.query(
        `INSERT INTO conversations(id,kind,title,owner_id,created_at,updated_at) VALUES ($1,$2,$3,$4,to_timestamp($5/1000.0),to_timestamp($6/1000.0))
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,updated_at=EXCLUDED.updated_at`,
        [id, kind, conversation.name ?? (conversationMembers.length === 1 ? "Saved Messages" : ""), userId(ownerLegacyId), conversation.created_at, conversation.updated_at ?? conversation.created_at]);
      for (const member of conversationMembers) await client.query(
        `INSERT INTO conversation_members(conversation_id,user_id,role,muted_until,joined_at) VALUES ($1,$2,$3,CASE WHEN $4::bigint IS NULL THEN NULL ELSE to_timestamp($4/1000.0) END,to_timestamp($5/1000.0))
         ON CONFLICT (conversation_id,user_id) DO UPDATE SET muted_until=EXCLUDED.muted_until`,
        [id, userId(member.user_id), normalizedConversationRole(member.role, member.user_id === ownerLegacyId), member.muted_until ?? null, member.joined_at]);
      await mapLegacy(client, "conversation", conversation.id, id);
    }

    const sequence = new Map<string, number>();
    for (const message of messages) {
      const legacyStream = message.conversation_id ?? "global"; const isGlobal = legacyStream === "global";
      const streamId = isGlobal ? generalChannelId : conversationId(legacyStream); const streamKind = isGlobal ? "channel" : "conversation";
      const next = (sequence.get(legacyStream) ?? 0) + 1; sequence.set(legacyStream, next);
      const id = messageId(message.id);
      await client.query(
        `INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text,created_at,edited_at,pinned_at,pinned_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0),CASE WHEN $10::bigint IS NULL THEN NULL ELSE to_timestamp($10/1000.0) END,
           CASE WHEN $11::bigint IS NULL THEN NULL ELSE to_timestamp($11/1000.0) END,$12)
         ON CONFLICT (id) DO UPDATE SET text=EXCLUDED.text,edited_at=EXCLUDED.edited_at,pinned_at=EXCLUDED.pinned_at`,
        [id, streamKind, streamId, next, userId(message.user_id), deterministicId("legacy-client-message", message.id), legacyMessageKind(message), message.content, message.created_at, message.edited_at, message.pinned_at ?? null, message.pinned_by ? userId(message.pinned_by) : null]);
      if (message.file_id && fileMap.has(message.file_id)) await client.query("INSERT INTO message_attachments(message_id,attachment_id,position) VALUES ($1,$2,0) ON CONFLICT DO NOTHING", [id, fileMap.get(message.file_id)]);
      await mapLegacy(client, "message", message.id, id);
    }
    for (const message of messages.filter((item) => item.reply_to_id)) await client.query("UPDATE messages SET reply_to_id=$2 WHERE id=$1 AND EXISTS(SELECT 1 FROM messages WHERE id=$2)", [messageId(message.id), messageId(message.reply_to_id!)]);
    for (const [legacyStream, next] of sequence) {
      if (legacyStream === "global") await client.query("UPDATE channels SET next_message_sequence=$2 WHERE id=$1", [generalChannelId, next + 1]);
      else await client.query("UPDATE conversations SET next_message_sequence=$2 WHERE id=$1", [conversationId(legacyStream), next + 1]);
    }
    for (const reaction of reactions) await client.query(
      "INSERT INTO message_reactions(message_id,user_id,emoji,created_at) VALUES ($1,$2,$3,to_timestamp($4/1000.0)) ON CONFLICT DO NOTHING",
      [messageId(reaction.message_id), userId(reaction.user_id), reaction.emoji, reaction.created_at]);
    for (const friendship of friendships) { const [low, high] = orderedPair(userId(friendship.user_a_id), userId(friendship.user_b_id)); await client.query("INSERT INTO friendships(user_low_id,user_high_id,created_at) VALUES ($1,$2,to_timestamp($3/1000.0)) ON CONFLICT DO NOTHING", [low, high, friendship.created_at]); }
    for (const request of requests) await client.query(
      `INSERT INTO friend_requests(id,sender_id,receiver_id,status,created_at,responded_at) VALUES ($1,$2,$3,$4,to_timestamp($5/1000.0),CASE WHEN $6::bigint IS NULL THEN NULL ELSE to_timestamp($6/1000.0) END) ON CONFLICT (id) DO NOTHING`,
      [deterministicId("legacy-friend-request", request.id), userId(request.sender_id), userId(request.receiver_id), normalizedRequestStatus(request.status), request.created_at, request.responded_at]);
    for (const member of members) {
      if (!member.last_read_at) continue;
      const streamId = member.conversation_id === "global" ? generalChannelId : conversationId(member.conversation_id);
      const streamKind = member.conversation_id === "global" ? "channel" : "conversation";
      const last = await client.query<{ sequence: string }>("SELECT coalesce(max(sequence),0)::text sequence FROM messages WHERE stream_kind=$1 AND stream_id=$2 AND created_at<=to_timestamp($3/1000.0)", [streamKind, streamId, member.last_read_at]);
      await client.query("INSERT INTO read_states(user_id,stream_kind,stream_id,last_read_sequence) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,stream_kind,stream_id) DO UPDATE SET last_read_sequence=GREATEST(read_states.last_read_sequence,EXCLUDED.last_read_sequence)", [userId(member.user_id), streamKind, streamId, Number(last.rows[0]?.sequence ?? 0)]);
    }
  });

  const physical = await recursiveFiles(uploadsRoot);
  return { users: users.length, conversations: conversations.length, messages: messages.length, reactions: reactions.length, files: files.length,
    importedFiles: fileMap.size, missingFiles, physicalFiles: physical.length, untrackedPhysicalFiles: Math.max(0, physical.length - fileMap.size) };
}

async function upsertBlob(client: DbClient, object: { checksum: string; storageKey: string; bytes: number; detectedMimeType: string }) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO blobs(id,checksum_sha256,storage_key,bytes,detected_mime_type) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (checksum_sha256) DO UPDATE SET checksum_sha256=EXCLUDED.checksum_sha256 RETURNING id`,
    [newId(), object.checksum, object.storageKey, object.bytes, object.detectedMimeType]);
  return result.rows[0]!.id;
}
async function mapLegacy(client: DbClient, kind: string, legacyId: string, id: string) { await client.query("INSERT INTO legacy_import_map(entity_kind,legacy_id,new_id) VALUES ($1,$2,$3) ON CONFLICT (entity_kind,legacy_id) DO UPDATE SET new_id=EXCLUDED.new_id", [kind, legacyId, id]); }
function all<T>(db: Database.Database, table: string): T[] { return hasTable(db, table) ? db.prepare(`SELECT * FROM ${table}`).all() as T[] : []; }
function hasTable(db: Database.Database, table: string) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
function userId(id: string) { return deterministicId("legacy-user", id); }
function conversationId(id: string) { return deterministicId("legacy-conversation", id); }
function messageId(id: string) { return deterministicId("legacy-message", id); }
function legacyMessageKind(message: LegacyMessage) { if (message.type === "system") return "system"; if (message.file_id) return "file"; return "text"; }
function normalizedConversationRole(role: string | undefined, owner: boolean) { if (owner) return "owner"; return role === "admin" ? "admin" : "member"; }
function normalizedRequestStatus(status: string) { return ["pending","accepted","declined","cancelled"].includes(status) ? status : "cancelled"; }
function attachmentKind(mime: string) { if (mime.startsWith("image/")) return "image"; if (mime.startsWith("video/")) return "video"; if (mime.startsWith("audio/")) return "audio"; return "document"; }
async function exists(file: string) { return stat(file).then(() => true).catch(() => false); }
async function recursiveFiles(directory: string): Promise<string[]> { const output: string[] = []; for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) { const full = path.join(directory, entry.name); if (entry.isDirectory()) output.push(...await recursiveFiles(full)); else output.push(full); } return output; }
function parseArgs(values: string[]) { const result: { database?: string; uploads?: string } = {}; for (let i=0;i<values.length;i+=2) { const next=values[i+1]; if (!next) continue; if (values[i] === "--database") result.database=next; if (values[i] === "--uploads") result.uploads=next; } return result; }
