import type { MemberRole, ServerPermission } from "@snezhok/contracts";
import type { DbClient } from "../../db/pool.js";
import { pool } from "../../db/pool.js";
import { forbidden } from "../../lib/errors.js";

export const allServerPermissions: readonly ServerPermission[] = [
  "view_channels", "send_messages", "attach_files", "add_reactions", "manage_messages",
  "connect", "speak", "video", "screen_share", "move_members", "manage_channels",
  "manage_categories", "manage_members", "kick_members", "ban_members", "manage_roles",
  "manage_server", "view_audit_log",
];

const legacyPermissions: Record<MemberRole, readonly ServerPermission[]> = {
  owner: allServerPermissions,
  admin: allServerPermissions,
  moderator: ["view_channels", "send_messages", "attach_files", "add_reactions", "manage_messages", "connect", "speak", "video", "screen_share", "move_members", "manage_members", "kick_members"],
  member: ["view_channels", "send_messages", "attach_files", "add_reactions", "connect", "speak", "video", "screen_share"],
};

const legacyRank: Record<MemberRole, number> = { owner: 40_000, admin: 30_000, moderator: 20_000, member: 10_000 };

interface AuthorizationRow {
  role: MemberRole;
  owner_id: string;
  custom_permissions: ServerPermission[];
  highest_role_position: number;
}

export interface ServerAuthorization {
  serverId: string;
  userId: string;
  ownerId: string;
  role: MemberRole;
  permissions: ReadonlySet<ServerPermission>;
  rank: number;
  highestCustomRolePosition: number;
}

export async function serverAuthorization(
  serverId: string,
  userId: string,
  client: Pick<DbClient, "query"> = pool,
): Promise<ServerAuthorization> {
  const result = await client.query<AuthorizationRow>(
    `SELECT sm.role,s.owner_id,
       coalesce(array_agg(DISTINCT role_permission.permission) FILTER (WHERE role_permission.permission IS NOT NULL),'{}') custom_permissions,
       coalesce(max(sr.position),-1)::int highest_role_position
     FROM servers s
     JOIN server_members sm ON sm.server_id=s.id AND sm.user_id=$2
     LEFT JOIN server_member_roles smr ON smr.server_id=sm.server_id AND smr.user_id=sm.user_id
     LEFT JOIN server_roles sr ON sr.id=smr.role_id AND sr.server_id=smr.server_id
     LEFT JOIN LATERAL unnest(sr.permissions) AS role_permission(permission) ON true
     WHERE s.id=$1
       AND NOT EXISTS (SELECT 1 FROM server_bans b WHERE b.server_id=s.id AND b.user_id=sm.user_id)
     GROUP BY sm.role,s.owner_id`,
    [serverId, userId],
  );
  const row = result.rows[0];
  if (!row) throw forbidden("Server membership is required");
  const permissions = new Set<ServerPermission>([...legacyPermissions[row.role], ...row.custom_permissions]);
  return {
    serverId, userId, ownerId: row.owner_id, role: row.role, permissions,
    rank: legacyRank[row.role] + Math.max(-1, Number(row.highest_role_position)),
    highestCustomRolePosition: Number(row.highest_role_position),
  };
}

export async function requireServerPermission(
  serverId: string,
  userId: string,
  permission: ServerPermission,
  client: Pick<DbClient, "query"> = pool,
) {
  const auth = await serverAuthorization(serverId, userId, client);
  if (!auth.permissions.has(permission)) throw forbidden(`Server permission '${permission}' is required`);
  return auth;
}

interface OverrideRow {
  allow_permissions: ServerPermission[];
  deny_permissions: ServerPermission[];
}

/**
 * Resolves permissions for one channel using the established Discord order:
 * server roles, aggregate custom-role denies/allows, then the member-specific
 * deny/allow. Owners always retain every permission so an override can never
 * lock the owner out of server recovery.
 */
export async function channelAuthorization(
  channelId: string,
  userId: string,
  client: Pick<DbClient, "query"> = pool,
): Promise<ServerAuthorization> {
  const channel = await client.query<{ server_id: string }>("SELECT server_id FROM channels WHERE id=$1", [channelId]);
  const serverId = channel.rows[0]?.server_id;
  if (!serverId) throw forbidden("Channel access is required");
  const authorization = await serverAuthorization(serverId, userId, client);
  if (authorization.role === "owner") return { ...authorization, permissions: new Set(allServerPermissions) };

  const roleOverrides = await client.query<OverrideRow>(
    `SELECT override.allow_permissions,override.deny_permissions
     FROM channel_role_permission_overrides override
     JOIN server_member_roles membership ON membership.role_id=override.role_id
     WHERE override.channel_id=$1 AND membership.server_id=$2 AND membership.user_id=$3`,
    [channelId, serverId, userId],
  );
  const memberOverride = (await client.query<OverrideRow>(
    "SELECT allow_permissions,deny_permissions FROM channel_member_permission_overrides WHERE channel_id=$1 AND user_id=$2",
    [channelId, userId],
  )).rows[0];
  const everyoneOverride = (await client.query<OverrideRow>(
    "SELECT allow_permissions,deny_permissions FROM channel_everyone_permission_overrides WHERE channel_id=$1",
    [channelId],
  )).rows[0];
  const permissions = applyPermissionOverrides(authorization.permissions, roleOverrides.rows, memberOverride, everyoneOverride);
  return { ...authorization, permissions };
}

export async function requireChannelPermission(
  channelId: string,
  userId: string,
  permission: ServerPermission,
  client: Pick<DbClient, "query"> = pool,
) {
  const authorization = await channelAuthorization(channelId, userId, client);
  if (!authorization.permissions.has(permission)) throw forbidden(`Channel permission '${permission}' is required`);
  return authorization;
}

/** Returns only channels whose final role/member override grants visibility. */
export async function visibleChannelIdsForUser(userId: string, client: Pick<DbClient, "query"> = pool) {
  const rows = await client.query<{ id: string }>(
    `SELECT channel.id FROM channels channel JOIN server_members member ON member.server_id=channel.server_id
     WHERE member.user_id=$1 AND NOT EXISTS(
       SELECT 1 FROM server_bans ban WHERE ban.server_id=channel.server_id AND ban.user_id=$1
     )`,
    [userId],
  );
  const visible = await Promise.all(rows.rows.map(async ({ id }) => {
    try { return (await channelAuthorization(id, userId, client)).permissions.has("view_channels") ? id : null; }
    catch { return null; }
  }));
  return visible.filter((id): id is string => id !== null);
}

export function applyPermissionOverrides(
  base: ReadonlySet<ServerPermission>,
  roleOverrides: readonly OverrideRow[],
  memberOverride?: OverrideRow,
  everyoneOverride?: OverrideRow,
) {
  const permissions = new Set(base);
  if (everyoneOverride) {
    for (const permission of everyoneOverride.deny_permissions) permissions.delete(permission);
    for (const permission of everyoneOverride.allow_permissions) permissions.add(permission);
  }
  const roleDenied = new Set(roleOverrides.flatMap((override) => override.deny_permissions));
  const roleAllowed = new Set(roleOverrides.flatMap((override) => override.allow_permissions));
  for (const permission of roleDenied) permissions.delete(permission);
  for (const permission of roleAllowed) permissions.add(permission);
  if (memberOverride) {
    for (const permission of memberOverride.deny_permissions) permissions.delete(permission);
    for (const permission of memberOverride.allow_permissions) permissions.add(permission);
  }
  return permissions;
}

export function mayManageMember(actor: ServerAuthorization, target: ServerAuthorization) {
  if (actor.userId === target.userId || target.role === "owner") return false;
  if (actor.role === "owner") return true;
  if (actor.role === "admin") return target.role === "moderator" || target.role === "member";
  if (actor.role === "moderator") return target.role === "member";
  return target.role === "member" && actor.highestCustomRolePosition > target.highestCustomRolePosition;
}

export function mayAssignRole(actor: ServerAuthorization, rolePosition: number) {
  return actor.role === "owner" || actor.role === "admin"
    || (actor.permissions.has("manage_roles") && rolePosition < actor.highestCustomRolePosition);
}

export function mayAssignLegacyRole(actor: ServerAuthorization, role: Exclude<MemberRole, "owner">) {
  if (actor.role === "owner") return true;
  if (!actor.permissions.has("manage_members")) return false;
  if (actor.role === "admin") return role === "moderator" || role === "member";
  return role === "member";
}

export function permissionsForRole(role: MemberRole, custom: readonly ServerPermission[] = []) {
  return new Set<ServerPermission>([...legacyPermissions[role], ...custom]);
}
