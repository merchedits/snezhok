import type { PrivacyAudience, PrivacySettings } from "@snezhok/contracts";
import type { DbClient } from "../../db/pool.js";
import { pool } from "../../db/pool.js";
import { forbidden, notFound } from "../../lib/errors.js";

interface PrivacyRow {
  direct_messages: PrivacyAudience;
  group_invites: PrivacyAudience;
  profile_photos: PrivacyAudience;
}

export async function loadPrivacy(userId: string, client: Pick<DbClient, "query"> = pool): Promise<PrivacySettings> {
  const result = await client.query<PrivacyRow>(
    `SELECT direct_messages,group_invites,profile_photos
     FROM user_privacy_settings WHERE user_id=$1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) throw notFound("User not found");
  return mapPrivacy(row);
}

export async function updatePrivacy(
  userId: string,
  patch: Partial<PrivacySettings>,
  client: Pick<DbClient, "query"> = pool,
) {
  const result = await client.query<PrivacyRow>(
    `UPDATE user_privacy_settings SET
       direct_messages=coalesce($2,direct_messages),
       group_invites=coalesce($3,group_invites),
       profile_photos=coalesce($4,profile_photos),updated_at=now()
     WHERE user_id=$1
     RETURNING direct_messages,group_invites,profile_photos`,
    [userId, patch.directMessages ?? null, patch.groupInvites ?? null, patch.profilePhotos ?? null],
  );
  if (!result.rows[0]) throw notFound("User not found");
  return mapPrivacy(result.rows[0]);
}

export async function assertUsersCanInteract(
  actorId: string,
  recipientId: string,
  purpose: "direct_messages" | "group_invites",
  client: Pick<DbClient, "query"> = pool,
) {
  const result = await client.query<{
    deleted: boolean; blocked: boolean; friends: boolean; audience: PrivacyAudience;
  }>(
    `SELECT u.deleted_at IS NOT NULL deleted,
       EXISTS(SELECT 1 FROM user_blocks b
         WHERE (b.blocker_id=$1 AND b.blocked_id=$2) OR (b.blocker_id=$2 AND b.blocked_id=$1)) blocked,
       EXISTS(SELECT 1 FROM friendships f
         WHERE f.user_low_id=LEAST($1::uuid,$2::uuid) AND f.user_high_id=GREATEST($1::uuid,$2::uuid)) friends,
       CASE WHEN $3='direct_messages' THEN p.direct_messages ELSE p.group_invites END audience
     FROM users u JOIN user_privacy_settings p ON p.user_id=u.id WHERE u.id=$2`,
    [actorId, recipientId, purpose],
  );
  const state = result.rows[0];
  if (!state || state.deleted) throw notFound("User not found");
  if (state.blocked || !audienceAllows(state.audience, state.friends)) {
    // Do not disclose whether a block or a privacy rule rejected the action.
    throw forbidden("This user is not accepting the requested interaction");
  }
}

export async function assertDirectConversationMessagingAllowed(
  userId: string,
  conversationId: string,
  client: Pick<DbClient, "query"> = pool,
) {
  const result = await client.query<{ saved: boolean; other_id: string | null }>(
    `SELECT c.saved_owner_id IS NOT NULL saved,
       (SELECT cm2.user_id FROM conversation_members cm2
        WHERE cm2.conversation_id=c.id AND cm2.user_id<>$2 LIMIT 1) other_id
     FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id
     WHERE c.id=$1 AND cm.user_id=$2 AND c.kind='direct'`,
    [conversationId, userId],
  );
  const conversation = result.rows[0];
  if (!conversation || conversation.saved || !conversation.other_id) return;
  await assertUsersCanInteract(userId, conversation.other_id, "direct_messages", client);
}

export async function mayViewProfilePhotos(viewerId: string, ownerId: string, client: Pick<DbClient, "query"> = pool) {
  if (viewerId === ownerId) return true;
  const result = await client.query<{ blocked: boolean; friends: boolean; audience: PrivacyAudience }>(
    `SELECT EXISTS(SELECT 1 FROM user_blocks b
         WHERE (b.blocker_id=$1 AND b.blocked_id=$2) OR (b.blocker_id=$2 AND b.blocked_id=$1)) blocked,
       EXISTS(SELECT 1 FROM friendships f
         WHERE f.user_low_id=LEAST($1::uuid,$2::uuid) AND f.user_high_id=GREATEST($1::uuid,$2::uuid)) friends,
       p.profile_photos audience
     FROM user_privacy_settings p WHERE p.user_id=$2`,
    [viewerId, ownerId],
  );
  const state = result.rows[0];
  return Boolean(state && !state.blocked && audienceAllows(state.audience, state.friends));
}

export async function usersAreBlocked(viewerId: string, otherId: string, client: Pick<DbClient, "query"> = pool) {
  if (viewerId === otherId) return false;
  const result = await client.query<{ blocked: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM user_blocks b
       WHERE (b.blocker_id=$1 AND b.blocked_id=$2) OR (b.blocker_id=$2 AND b.blocked_id=$1)) blocked`,
    [viewerId, otherId],
  );
  return result.rows[0]?.blocked === true;
}

export function audienceAllows(audience: PrivacyAudience, friends: boolean) {
  return audience === "everyone" || (audience === "contacts" && friends);
}

function mapPrivacy(row: PrivacyRow): PrivacySettings {
  return {
    directMessages: row.direct_messages,
    groupInvites: row.group_invites,
    profilePhotos: row.profile_photos,
  };
}
