import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { DbClient } from "../../db/pool.js";
import type { ServerAuthorization } from "./permissions.js";
import { applyPermissionOverrides, channelAuthorization, mayAssignLegacyRole, mayAssignRole, mayManageMember, permissionsForRole, serverAuthorization, visibleChannelIdsForUser, visibleChannelUserIds } from "./permissions.js";

const auth = (overrides: Partial<ServerAuthorization>): ServerAuthorization => ({
  serverId: "server", userId: "actor", ownerId: "owner", role: "member",
  permissions: permissionsForRole("member"), rank: 10_000, highestCustomRolePosition: -1,
  ...overrides,
});

test("legacy roles preserve safe server defaults", () => {
  assert.equal(permissionsForRole("member").has("send_messages"), true);
  assert.equal(permissionsForRole("member").has("manage_messages"), false);
  assert.equal(permissionsForRole("moderator").has("kick_members"), true);
  assert.equal(permissionsForRole("admin").has("manage_server"), true);
});

test("member hierarchy is strict and never permits self or owner management", () => {
  const actor = auth({ role: "admin", permissions: permissionsForRole("admin"), rank: 30_000 });
  assert.equal(mayManageMember(actor, auth({ userId: "member", rank: 10_000 })), true);
  assert.equal(mayManageMember(actor, auth({ userId: "actor", rank: 10_000 })), false);
  assert.equal(mayManageMember(actor, auth({ userId: "owner", role: "owner", rank: 40_000 })), false);
  assert.equal(mayManageMember(actor, auth({ userId: "peer", role: "admin", rank: 29_999 })), false);
});

test("custom roles can only assign roles below their own highest role", () => {
  const manager = auth({ permissions: permissionsForRole("member", ["manage_roles"]), highestCustomRolePosition: 50 });
  assert.equal(mayAssignRole(manager, 49), true);
  assert.equal(mayAssignRole(manager, 50), false);
  assert.equal(mayAssignRole(manager, 51), false);
  assert.equal(mayAssignRole(auth({ role: "owner" }), 10_000), true);
});

test("legacy role assignment follows the same strict hierarchy", () => {
  assert.equal(mayAssignLegacyRole(auth({ role: "admin", permissions: permissionsForRole("admin"), rank: 30_000 }), "moderator"), true);
  assert.equal(mayAssignLegacyRole(auth({ role: "admin", permissions: permissionsForRole("admin"), rank: 30_000 }), "admin"), false);
  assert.equal(mayAssignLegacyRole(auth({ role: "admin", permissions: permissionsForRole("admin"), rank: 30_100 }), "admin"), false);
  assert.equal(mayAssignLegacyRole(auth({ role: "owner", rank: 40_000 }), "admin"), true);
});

test("action-specific moderation permission does not require manage_members", () => {
  const actor = auth({ userId: "kicker", permissions: permissionsForRole("member", ["kick_members"]), highestCustomRolePosition: 20, rank: 10_020 });
  assert.equal(mayManageMember(actor, auth({ userId: "lower", highestCustomRolePosition: 5, rank: 10_005 })), true);
  assert.equal(mayManageMember(actor, auth({ userId: "peer", highestCustomRolePosition: 20, rank: 10_020 })), false);
  assert.equal(mayManageMember(actor, auth({ userId: "higher", highestCustomRolePosition: 30, rank: 10_030 })), false);
  assert.equal(mayManageMember(actor, auth({ userId: "kicker" })), false);
  assert.equal(mayManageMember(actor, auth({ userId: "owner", role: "owner" })), false);
});

test("channel override precedence is everyone, aggregate roles, then member", () => {
  const result = applyPermissionOverrides(
    permissionsForRole("member"),
    [{ allow_permissions: ["send_messages"], deny_permissions: ["attach_files"] }],
    { allow_permissions: ["attach_files"], deny_permissions: ["send_messages"] },
    { allow_permissions: [], deny_permissions: ["view_channels"] },
  );
  assert.equal(result.has("view_channels"), false);
  assert.equal(result.has("attach_files"), true);
  assert.equal(result.has("send_messages"), false);
});

test("effective authorization combines legacy and assigned permissions and rejects bans", async () => {
  const db = new PGlite();
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const migrations = path.resolve(here, "../../../migrations");
    for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(path.join(migrations, file), "utf8"));
    const owner = "10000000-0000-4000-8000-000000000001";
    const member = "10000000-0000-4000-8000-000000000002";
    const server = "20000000-0000-4000-8000-000000000001";
    const role = "30000000-0000-4000-8000-000000000001";
    const channel = "40000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'owner_user','Owner'),($2,'member_user','Member')", [owner, member]);
    await db.query("INSERT INTO servers(id,owner_id,name) VALUES ($1,$2,'Server')", [server, owner]);
    await db.query("INSERT INTO server_members(server_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')", [server, owner, member]);
    await db.query("INSERT INTO server_roles(id,server_id,name,position,permissions) VALUES ($1,$2,'Writer',5,ARRAY['manage_messages']::text[])", [role, server]);
    await db.query("INSERT INTO server_member_roles(server_id,user_id,role_id) VALUES ($1,$2,$3)", [server, member, role]);
    await db.query("INSERT INTO channels(id,server_id,kind,name) VALUES ($1,$2,'text','private')", [channel, server]);
    const client = db as unknown as Pick<DbClient, "query">;
    const authorization = await serverAuthorization(server, member, client);
    assert.equal(authorization.permissions.has("send_messages"), true);
    assert.equal(authorization.permissions.has("manage_messages"), true);
    assert.equal(authorization.highestCustomRolePosition, 5);
    assert.deepEqual(await visibleChannelIdsForUser(member, client), [channel]);
    assert.deepEqual(await visibleChannelUserIds(channel, client), [owner, member]);
    await db.query("INSERT INTO channel_everyone_permission_overrides(channel_id,deny_permissions) VALUES ($1,ARRAY['view_channels']::text[])", [channel]);
    assert.equal((await channelAuthorization(channel, member, client)).permissions.has("view_channels"), false);
    assert.deepEqual(await visibleChannelIdsForUser(member, client), []);
    assert.deepEqual(await visibleChannelUserIds(channel, client), [owner]);
    await db.query("INSERT INTO channel_member_permission_overrides(channel_id,user_id,allow_permissions) VALUES ($1,$2,ARRAY['view_channels']::text[])", [channel, member]);
    assert.equal((await channelAuthorization(channel, member, client)).permissions.has("view_channels"), true);
    assert.deepEqual(await visibleChannelIdsForUser(member, client), [channel]);
    assert.deepEqual(await visibleChannelUserIds(channel, client), [owner, member]);
    await db.query("INSERT INTO server_bans(server_id,user_id,banned_by) VALUES ($1,$2,$3)", [server, member, owner]);
    await assert.rejects(() => serverAuthorization(server, member, client));
    assert.deepEqual(await visibleChannelIdsForUser(member, client), []);
    assert.deepEqual(await visibleChannelUserIds(channel, client), [owner]);
  } finally { await db.close(); }
});
