import type { FriendEntry } from "@snezhok/contracts";
import type { DbClient } from "../../db/pool.js";
import { pool, transaction } from "../../db/pool.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { publishStoredEvent, storeEvent } from "../realtime/events.js";
import { findUser, mapContactUser, mapUser, publicUserSelect, type PublicUserRow } from "../users/queries.js";
import { terminateDirectCallsBetween } from "../calls/mediaControl.js";

export async function listFriends(userId: string, client: Pick<DbClient, "query"> = pool): Promise<FriendEntry[]> {
  const result = await client.query<PublicUserRow & { relationship: FriendEntry["relationship"]; request_id: string | null }>(
    `SELECT ${publicUserSelect},x.relationship,x.request_id FROM (
       SELECT CASE WHEN f.user_low_id=$1 THEN f.user_high_id ELSE f.user_low_id END user_id,'friend'::text relationship,NULL::uuid request_id
       FROM friendships f WHERE f.user_low_id=$1 OR f.user_high_id=$1
       UNION ALL SELECT CASE WHEN r.sender_id=$1 THEN r.receiver_id ELSE r.sender_id END,
         CASE WHEN r.sender_id=$1 THEN 'outgoing' ELSE 'incoming' END,r.id FROM friend_requests r
         WHERE (r.sender_id=$1 OR r.receiver_id=$1) AND r.status='pending'
       UNION ALL SELECT b.blocked_id,'blocked',NULL::uuid FROM user_blocks b WHERE b.blocker_id=$1
     ) x JOIN users u ON u.id=x.user_id AND u.deleted_at IS NULL ORDER BY u.display_name`, [userId]);
  return result.rows.map((row) => {
    const mapped = row.relationship === "friend" ? mapContactUser(row) : mapUser(row);
    const user = row.relationship === "blocked"
      ? { ...mapped, avatarUrl: null, bio: "", statusText: "", presence: "offline" as const, lastSeenAt: 0 }
      : mapped;
    return { user, relationship: row.relationship, ...(row.request_id ? { requestId: row.request_id } : {}) };
  });
}

export async function requestFriend(senderId: string, username: string) {
  const result = await transaction(async (client) => {
    const receiver = (await client.query<{ id: string }>("SELECT id FROM users WHERE username=$1 AND deleted_at IS NULL", [username])).rows[0];
    if (!receiver) throw notFound("User not found");
    if (receiver.id === senderId) throw conflict("You cannot add yourself");
    if (await pairExists(client, "friendships", senderId, receiver.id)) throw conflict("You are already friends");
    const blocked = await client.query("SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)", [senderId, receiver.id]);
    if (blocked.rowCount) throw forbidden("Friend request is unavailable");
    const id = newId();
    await client.query("INSERT INTO friend_requests(id,sender_id,receiver_id) VALUES ($1,$2,$3)", [id, senderId, receiver.id]);
    const senderEntry = await entryFor(client, senderId, receiver.id, "outgoing", id);
    const receiverEntry = await entryFor(client, receiver.id, senderId, "incoming", id);
    return { senderEntry, receiverEntry, events: [
      await storeEvent(client, [senderId], "friend:updated", senderEntry),
      await storeEvent(client, [receiver.id], "friend:updated", receiverEntry),
    ] };
  });
  result.events.forEach(publishStoredEvent);
  return result.senderEntry;
}

export async function respondFriend(userId: string, requestId: string, action: "accept" | "decline") {
  const result = await transaction(async (client) => {
    const request = (await client.query<{ sender_id: string; receiver_id: string }>("SELECT sender_id,receiver_id FROM friend_requests WHERE id=$1 AND status='pending' FOR UPDATE", [requestId])).rows[0];
    if (!request || request.receiver_id !== userId) throw notFound("Friend request not found");
    await client.query("UPDATE friend_requests SET status=$2,responded_at=now() WHERE id=$1", [requestId, action === "accept" ? "accepted" : "declined"]);
    if (action === "accept") {
      const [low, high] = orderedPair(request.sender_id, request.receiver_id);
      await client.query("INSERT INTO friendships(user_low_id,user_high_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [low, high]);
    }
    const senderEntry = await entryFor(client, request.sender_id, request.receiver_id, "friend", null);
    const receiverEntry = await entryFor(client, request.receiver_id, request.sender_id, "friend", null);
    const events = action === "accept"
      ? [await storeEvent(client, [request.sender_id], "friend:updated", senderEntry), await storeEvent(client, [request.receiver_id], "friend:updated", receiverEntry)]
      : [await storeEvent(client, [request.sender_id, request.receiver_id], "friend:removed", (recipient: string) => ({ userId: recipient === request.sender_id ? request.receiver_id : request.sender_id }))];
    return { entry: receiverEntry, events };
  });
  result.events.forEach(publishStoredEvent);
  return result.entry;
}

export async function removeFriend(userId: string, otherId: string) {
  const event = await transaction(async (client) => {
    const [low, high] = orderedPair(userId, otherId);
    const result = await client.query("DELETE FROM friendships WHERE user_low_id=$1 AND user_high_id=$2", [low, high]);
    if (!result.rowCount) throw notFound("Friendship not found");
    return storeEvent(client, [userId, otherId], "friend:removed", (recipient: string) => ({ userId: recipient === userId ? otherId : userId }));
  });
  publishStoredEvent(event);
}

export async function cancelRequest(userId: string, requestId: string) {
  const event = await transaction(async (client) => {
    const result = await client.query<{ receiver_id: string }>("UPDATE friend_requests SET status='cancelled',responded_at=now() WHERE id=$1 AND sender_id=$2 AND status='pending' RETURNING receiver_id", [requestId, userId]);
    if (!result.rows[0]) throw notFound("Outgoing request not found");
    const otherId = result.rows[0].receiver_id;
    return storeEvent(client, [userId, otherId], "friend:removed", (recipient: string) => ({ userId: recipient === userId ? otherId : userId }));
  });
  publishStoredEvent(event);
}

export async function blockUser(userId: string, otherId: string) {
  if (userId === otherId) throw conflict("You cannot block yourself");
  const events = await transaction(async (client) => {
    const user = await findUser(otherId, client); if (!user) throw notFound("User not found");
    const [low, high] = orderedPair(userId, otherId);
    await client.query("DELETE FROM friendships WHERE user_low_id=$1 AND user_high_id=$2", [low, high]);
    await client.query("UPDATE friend_requests SET status='cancelled',responded_at=now() WHERE status='pending' AND ((sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1))", [userId, otherId]);
    await client.query("INSERT INTO user_blocks(blocker_id,blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [userId, otherId]);
    const callEvents = await terminateDirectCallsBetween(client, userId, otherId, "user-blocked");
    return [
      ...callEvents,
      await storeEvent(client, [userId, otherId], "friend:removed", (recipient: string) => ({ userId: recipient === userId ? otherId : userId })),
      await storeEvent(client, [userId, otherId], "presence:updated", (recipient: string) => ({ userId: recipient === userId ? otherId : userId, presence: "offline", lastSeenAt: 0 })),
    ];
  });
  events.forEach(publishStoredEvent);
}

export async function unblockUser(userId: string, otherId: string) {
  const result = await pool.query("DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2", [userId, otherId]);
  if (!result.rowCount) throw notFound("Blocked user not found");
}

async function entryFor(client: DbClient, ownerId: string, otherId: string, relationship: FriendEntry["relationship"], requestId: string | null): Promise<FriendEntry> {
  const user = await findUser(otherId, client);
  if (!user) throw notFound("User not found");
  return { user: relationship === "friend" ? mapContactUser(user) : mapUser(user), relationship, ...(requestId ? { requestId } : {}) };
}

async function pairExists(client: DbClient, table: "friendships", a: string, b: string) {
  const [low, high] = orderedPair(a, b);
  return Boolean((await client.query(`SELECT 1 FROM ${table} WHERE user_low_id=$1 AND user_high_id=$2`, [low, high])).rowCount);
}

export function orderedPair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a]; }
