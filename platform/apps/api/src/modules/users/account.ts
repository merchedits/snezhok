import type { DbClient } from "../../db/pool.js";
import { transaction } from "../../db/pool.js";
import { conflict, notFound, unauthorized } from "../../lib/errors.js";
import { verifyCurrentPassword } from "../auth/service.js";
import { publishStoredEvent, storeEvent } from "../realtime/events.js";
import { terminateCallsForUser } from "../calls/mediaControl.js";

export async function deleteAccount(userId: string, password: string) {
  const result = await transaction(async (client) => {
    const account = await client.query<{ username: string }>(
      "SELECT username FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [userId],
    );
    if (!account.rows[0]) throw notFound("Account not found");
    if (!(await verifyCurrentPassword(userId, password, client))) throw unauthorized("Password is incorrect");
    await assertMayDeleteAccount(client, userId);

    const recipients = await affectedUsers(userId, client);
    const callEvents = await terminateCallsForUser(client, userId, "account-deleted");
    await transferOrDeleteOwnedServers(userId, client);
    await transferOrDeleteOwnedConversations(userId, client);

    await client.query("DELETE FROM server_members WHERE user_id=$1 AND role<>'owner'", [userId]);
    await client.query("DELETE FROM conversation_members cm USING conversations c WHERE cm.user_id=$1 AND cm.conversation_id=c.id AND c.kind='group'", [userId]);
    await client.query("UPDATE conversations SET owner_id=NULL WHERE owner_id=$1 AND kind='direct' AND saved_owner_id IS NULL", [userId]);
    await client.query("DELETE FROM friendships WHERE user_low_id=$1 OR user_high_id=$1", [userId]);
    await client.query("DELETE FROM friend_requests WHERE sender_id=$1 OR receiver_id=$1", [userId]);
    await client.query("DELETE FROM user_blocks WHERE blocker_id=$1 OR blocked_id=$1", [userId]);
    await client.query("DELETE FROM user_profile_photos WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM chat_drafts WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM chat_folders WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM scheduled_messages WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM hidden_messages WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM message_reactions WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM message_mentions WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM read_states WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM stream_notification_settings WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM push_delivery_outbox WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM credentials WHERE user_id=$1", [userId]);
    await client.query("UPDATE device_sessions SET revoked_at=coalesce(revoked_at,now()),revoked_reason='account_deleted',label='Deleted session',ip_address=NULL,user_agent='' WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM push_devices WHERE user_id=$1", [userId]);
    await client.query("UPDATE upload_sessions SET status='cancelled',updated_at=now() WHERE owner_id=$1 AND status IN ('uploading','receiving','finalizing')", [userId]);
    await client.query("DELETE FROM user_events WHERE user_id=$1", [userId]);
    await client.query("UPDATE server_audit_log SET actor_id=NULL WHERE actor_id=$1", [userId]);
    await client.query("UPDATE server_audit_log SET target_user_id=NULL WHERE target_user_id=$1", [userId]);
    await client.query(
      `UPDATE user_settings SET settings=settings || '{"showLastSeen":false,"messageNotifications":false,"callNotifications":false}'::jsonb,updated_at=now()
       WHERE user_id=$1`,
      [userId],
    );
    await client.query(
      `UPDATE user_privacy_settings SET direct_messages='nobody',group_invites='nobody',profile_photos='nobody',updated_at=now()
       WHERE user_id=$1`,
      [userId],
    );
    const tombstone = `deleted-${userId.replaceAll("-", "").slice(0, 24)}`;
    await client.query(
      `UPDATE users SET email=NULL,username=$2,display_name='Deleted Account',avatar_attachment_id=NULL,
         avatar_color='#7b8190',bio='',status_text='',presence_preference='invisible',is_admin=false,
         deleted_at=now(),updated_at=now(),last_seen_at=now()
       WHERE id=$1`,
      [userId, tombstone],
    );

    const deletedEvent = recipients.length ? await storeEvent(client, recipients, "user:deleted", { id: userId }) : null;
    return { events: [...callEvents, ...(deletedEvent ? [deletedEvent] : [])], mediaChanged: callEvents.length > 0 };
  });
  result.events.forEach(publishStoredEvent);
  return { mediaChanged: result.mediaChanged };
}

export async function assertMayDeleteAccount(client: Pick<DbClient, "query">, userId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [492_001_732]);
  const current = (await client.query<{ is_admin: boolean }>(
    "SELECT is_admin FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
    [userId],
  )).rows[0];
  if (!current?.is_admin) return;
  const replacement = await client.query(
    "SELECT 1 FROM users WHERE is_admin=true AND suspended_at IS NULL AND deleted_at IS NULL AND id<>$1 LIMIT 1",
    [userId],
  );
  if (!replacement.rowCount) throw conflict("Transfer administrator access before deleting the final active administrator");
}

async function affectedUsers(userId: string, client: DbClient) {
  const result = await client.query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM (
       SELECT CASE WHEN f.user_low_id=$1 THEN f.user_high_id ELSE f.user_low_id END user_id
       FROM friendships f WHERE f.user_low_id=$1 OR f.user_high_id=$1
       UNION ALL
       SELECT cm2.user_id FROM conversation_members mine
       JOIN conversation_members cm2 ON cm2.conversation_id=mine.conversation_id
       WHERE mine.user_id=$1 AND cm2.user_id<>$1
       UNION ALL
       SELECT sm2.user_id FROM server_members mine
       JOIN server_members sm2 ON sm2.server_id=mine.server_id
       WHERE mine.user_id=$1 AND sm2.user_id<>$1
     ) affected JOIN users u ON u.id=affected.user_id WHERE u.deleted_at IS NULL`,
    [userId],
  );
  return result.rows.map((row) => row.user_id);
}

async function transferOrDeleteOwnedServers(userId: string, client: DbClient) {
  const servers = await client.query<{ id: string }>("SELECT id FROM servers WHERE owner_id=$1 FOR UPDATE", [userId]);
  for (const server of servers.rows) {
    const successor = (await client.query<{ user_id: string }>(
      `SELECT sm.user_id FROM server_members sm JOIN users u ON u.id=sm.user_id
       WHERE sm.server_id=$1 AND sm.user_id<>$2 AND u.deleted_at IS NULL
       ORDER BY CASE sm.role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,sm.joined_at,sm.user_id LIMIT 1 FOR UPDATE OF sm`,
      [server.id, userId],
    )).rows[0];
    if (!successor) {
      const channelIds = (await client.query<{ id: string }>("SELECT id FROM channels WHERE server_id=$1", [server.id])).rows.map((row) => row.id);
      await deleteStreams("channel", channelIds, client);
      await client.query("DELETE FROM servers WHERE id=$1", [server.id]);
      continue;
    }
    await client.query("UPDATE servers SET owner_id=$2,updated_at=now() WHERE id=$1", [server.id, successor.user_id]);
    await client.query("UPDATE server_members SET role=CASE WHEN user_id=$2 THEN 'owner' ELSE 'member' END WHERE server_id=$1 AND user_id=ANY($3::uuid[])", [server.id, successor.user_id, [userId, successor.user_id]]);
    await client.query(
      "INSERT INTO server_audit_log(server_id,actor_id,action,target_user_id,metadata) VALUES ($1,NULL,'ownership.transferred_account_deletion',$2,$3)",
      [server.id, successor.user_id, { reason: "account-deletion" }],
    );
  }
}

async function transferOrDeleteOwnedConversations(userId: string, client: DbClient) {
  const conversations = await client.query<{ id: string; kind: "direct" | "group"; saved_owner_id: string | null }>(
    "SELECT id,kind,saved_owner_id FROM conversations WHERE owner_id=$1 FOR UPDATE",
    [userId],
  );
  for (const conversation of conversations.rows) {
    if (conversation.saved_owner_id) {
      await deleteStreams("conversation", [conversation.id], client);
      await client.query("DELETE FROM conversations WHERE id=$1", [conversation.id]);
      continue;
    }
    if (conversation.kind === "direct") continue;
    const successor = (await client.query<{ user_id: string }>(
      `SELECT cm.user_id FROM conversation_members cm JOIN users u ON u.id=cm.user_id
       WHERE cm.conversation_id=$1 AND cm.user_id<>$2 AND u.deleted_at IS NULL
       ORDER BY CASE cm.role WHEN 'admin' THEN 0 ELSE 1 END,cm.joined_at,cm.user_id LIMIT 1 FOR UPDATE OF cm`,
      [conversation.id, userId],
    )).rows[0];
    if (!successor) {
      await deleteStreams("conversation", [conversation.id], client);
      await client.query("DELETE FROM conversations WHERE id=$1", [conversation.id]);
      continue;
    }
    await client.query("UPDATE conversations SET owner_id=$2,updated_at=now() WHERE id=$1", [conversation.id, successor.user_id]);
    await client.query("UPDATE conversation_members SET role=CASE WHEN user_id=$2 THEN 'owner' ELSE 'member' END WHERE conversation_id=$1 AND user_id=ANY($3::uuid[])", [conversation.id, successor.user_id, [userId, successor.user_id]]);
  }
}

async function deleteStreams(kind: "conversation" | "channel", ids: string[], client: DbClient) {
  if (!ids.length) return;
  await client.query("DELETE FROM messages WHERE stream_kind=$1 AND stream_id=ANY($2::uuid[])", [kind, ids]);
  await client.query("DELETE FROM read_states WHERE stream_kind=$1 AND stream_id=ANY($2::uuid[])", [kind, ids]);
  await client.query("DELETE FROM chat_drafts WHERE stream_kind=$1 AND stream_id=ANY($2::uuid[])", [kind, ids]);
  await client.query("DELETE FROM chat_folder_streams WHERE stream_kind=$1 AND stream_id=ANY($2::uuid[])", [kind, ids]);
  await client.query("DELETE FROM scheduled_messages WHERE stream_kind=$1 AND stream_id=ANY($2::uuid[])", [kind, ids]);
  await client.query("DELETE FROM stream_notification_settings WHERE stream_kind=$1 AND stream_id=ANY($2::uuid[])", [kind, ids]);
}
