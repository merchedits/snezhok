import type { FastifyInstance } from "fastify";
import type { ChannelPermissionOverride, MemberRole, ServerAuditEntry, ServerPermission, ServerRoleDefinition } from "@snezhok/contracts";
import {
  categoryCreateSchema, categoryUpdateSchema, channelCreateSchema, channelPermissionOverrideSchema, channelUpdateSchema,
  ownershipTransferSchema, serverBanSchema, serverCreateSchema, serverMemberUpdateSchema,
  serverRoleCreateSchema, serverRoleUpdateSchema, serverUpdateSchema,
} from "@snezhok/contracts";
import { z } from "zod";
import { pool, transaction, type DbClient } from "../../db/pool.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { requireAuth } from "../auth/middleware.js";
import { publishStoredEvent, storeEvent, type StoredEvent } from "../realtime/events.js";
import { assertUsersCanInteract } from "../users/privacy.js";
import { mapUser, publicUserSelect, type PublicUserRow } from "../users/queries.js";
import { requireGlobalPermission } from "../admin/policy.js";
import {
  requestCallMediaDrain, terminateChannelCalls, terminateServerCalls,
} from "../calls/mediaControl.js";
import {
  channelAuthorization, mayAssignLegacyRole, mayAssignRole, mayManageMember, requireServerPermission,
  serverAuthorization, visibleChannelUserIds, type ServerAuthorization,
} from "./permissions.js";

const serverParams = z.object({ serverId: z.string().uuid() });
const memberParams = z.object({ serverId: z.string().uuid(), userId: z.string().uuid() });
const categoryParams = z.object({ serverId: z.string().uuid(), categoryId: z.string().uuid() });
const channelParams = z.object({ serverId: z.string().uuid(), channelId: z.string().uuid() });
const roleParams = z.object({ serverId: z.string().uuid(), roleId: z.string().uuid() });
const channelRoleOverrideParams = z.object({ serverId: z.string().uuid(), channelId: z.string().uuid(), roleId: z.string().uuid() });
const channelMemberOverrideParams = z.object({ serverId: z.string().uuid(), channelId: z.string().uuid(), userId: z.string().uuid() });
const memberCreateSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "moderator", "member"]).default("member"),
  roleIds: z.array(z.string().uuid()).max(50).refine((ids) => new Set(ids).size === ids.length, "Server roles must be unique").default([]),
});
const auditQuerySchema = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

export async function serverRoutes(app: FastifyInstance) {
  app.post("/servers", { preHandler: requireAuth }, async (request, reply) => {
    const { name } = serverCreateSchema.parse(request.body);
    const id = newId(); const generalId = newId();
    const result = await transaction(async (client) => {
      await requireGlobalPermission(request.auth.id, "createServers", client);
      await client.query("INSERT INTO servers(id,owner_id,name) VALUES ($1,$2,$3)", [id, request.auth.id, name]);
      await client.query("INSERT INTO server_members(server_id,user_id,role) VALUES ($1,$2,'owner')", [id, request.auth.id]);
      await client.query("INSERT INTO channels(id,server_id,kind,name,position) VALUES ($1,$2,'text','general',0)", [generalId, id]);
      await writeAudit(client, id, request.auth.id, "server.created", { name });
      const server = await loadServerSummary(id, request.auth.id, client);
      const channel = await loadChannelSummary(generalId, request.auth.id, client);
      return { server, channel, events: [
        await storeEvent(client, [request.auth.id], "server:updated", server),
        await storeEvent(client, [request.auth.id], "channel:updated", channel),
      ] };
    });
    publishAll(result.events);
    return reply.status(201).send({ server: result.server, channel: result.channel });
  });

  app.get("/servers/:serverId", { preHandler: requireAuth }, async (request) => {
    const { serverId } = serverParams.parse(request.params);
    const authorization = await requireServerPermission(serverId, request.auth.id, "view_channels");
    return { server: await loadServerSummary(serverId, request.auth.id), authorization: serializeAuthorization(authorization) };
  });

  app.patch("/servers/:serverId", { preHandler: requireAuth }, async (request) => {
    const { serverId } = serverParams.parse(request.params); const body = serverUpdateSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      await requireServerPermission(serverId, request.auth.id, "manage_server", client);
      if (body.iconAttachmentId) await requireOwnedImage(body.iconAttachmentId, request.auth.id, client, "Server icon");
      const updated = await client.query(
        `UPDATE servers SET name=coalesce($2,name),icon_attachment_id=CASE WHEN $3::boolean THEN $4::uuid ELSE icon_attachment_id END,updated_at=now()
         WHERE id=$1 RETURNING id`,
        [serverId, body.name ?? null, body.iconAttachmentId !== undefined, body.iconAttachmentId ?? null],
      );
      if (!updated.rowCount) throw notFound("Server not found");
      await writeAudit(client, serverId, request.auth.id, "server.updated", body);
      const recipients = await serverRecipientIds(serverId, client);
      const summaries = new Map<string, Awaited<ReturnType<typeof loadServerSummary>>>();
      for (const recipient of recipients) summaries.set(recipient, await loadServerSummary(serverId, recipient, client));
      return { server: summaries.get(request.auth.id)!, event: await storeEvent(client, recipients, "server:updated", (recipient: string) => summaries.get(recipient)) };
    });
    publishStoredEvent(result.event); return { server: result.server };
  });

  app.delete("/servers/:serverId", { preHandler: requireAuth }, async (request) => {
    const { serverId } = serverParams.parse(request.params);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      const authorization = await serverAuthorization(serverId, request.auth.id, client);
      if (authorization.role !== "owner") throw forbidden("Only the server owner can delete a server");
      const recipients = await serverRecipientIds(serverId, client);
      const channelIds = (await client.query<{ id: string }>("SELECT id FROM channels WHERE server_id=$1", [serverId])).rows.map((row) => row.id);
      const callEvents = await deleteChannelStreams(channelIds, client);
      await client.query("DELETE FROM servers WHERE id=$1", [serverId]);
      return { event: await storeEvent(client, recipients, "server:removed", { id: serverId }), callEvents };
    });
    publishStoredEvent(result.event); publishAll(result.callEvents); requestCallMediaDrain(app.log); return { success: true };
  });

  app.post("/servers/:serverId/ownership", { preHandler: requireAuth }, async (request) => {
    const { serverId } = serverParams.parse(request.params); const { userId } = ownershipTransferSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      const actor = await serverAuthorization(serverId, request.auth.id, client);
      if (actor.role !== "owner") throw forbidden("Only the server owner can transfer ownership");
      if (userId === request.auth.id) throw conflict("This account already owns the server");
      await serverAuthorization(serverId, userId, client);
      await client.query("UPDATE servers SET owner_id=$2,updated_at=now() WHERE id=$1", [serverId, userId]);
      await client.query("UPDATE server_members SET role=CASE WHEN user_id=$2 THEN 'owner' ELSE 'admin' END WHERE server_id=$1 AND user_id=ANY($3::uuid[])", [serverId, userId, [request.auth.id, userId]]);
      const callEvents = await terminateServerCalls(client, serverId, "permission-changed");
      await writeAudit(client, serverId, request.auth.id, "ownership.transferred", {}, userId);
      const recipients = await serverRecipientIds(serverId, client);
      return { event: await storeEvent(client, recipients, "membership:updated", { serverId, userId, state: "updated" }), callEvents };
    });
    publishStoredEvent(result.event); publishAll(result.callEvents); requestCallMediaDrain(app.log); return { success: true };
  });

  app.post("/servers/:serverId/categories", { preHandler: requireAuth }, async (request, reply) => {
    const { serverId } = serverParams.parse(request.params); const body = categoryCreateSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      await requireServerPermission(serverId, request.auth.id, "manage_categories", client);
      const id = newId(); const position = await nextPosition("channel_categories", serverId, client);
      await client.query("INSERT INTO channel_categories(id,server_id,name,position) VALUES ($1,$2,$3,$4)", [id, serverId, body.name, position]);
      await writeAudit(client, serverId, request.auth.id, "category.created", { name: body.name }, null, id);
      const category = { id, serverId, name: body.name, position, collapsed: false };
      return { category, event: await storeEvent(client, await serverRecipientIds(serverId, client), "category:updated", category) };
    });
    publishStoredEvent(result.event); return reply.status(201).send({ category: result.category });
  });

  app.patch("/servers/:serverId/categories/:categoryId", { preHandler: requireAuth }, async (request) => {
    const { serverId, categoryId } = categoryParams.parse(request.params); const body = categoryUpdateSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      await requireServerPermission(serverId, request.auth.id, "manage_categories", client);
      const updated = await client.query<{ name: string; position: number }>(
        "UPDATE channel_categories SET name=coalesce($3,name),position=coalesce($4,position) WHERE id=$1 AND server_id=$2 RETURNING name,position",
        [categoryId, serverId, body.name ?? null, body.position ?? null],
      );
      if (!updated.rows[0]) throw notFound("Category not found");
      await writeAudit(client, serverId, request.auth.id, "category.updated", body, null, categoryId);
      const category = { id: categoryId, serverId, name: updated.rows[0].name, position: updated.rows[0].position, collapsed: false };
      return { category, event: await storeEvent(client, await serverRecipientIds(serverId, client), "category:updated", category) };
    });
    publishStoredEvent(result.event); return { category: result.category };
  });

  app.delete("/servers/:serverId/categories/:categoryId", { preHandler: requireAuth }, async (request) => {
    const { serverId, categoryId } = categoryParams.parse(request.params);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      await requireServerPermission(serverId, request.auth.id, "manage_categories", client);
      const deleted = await client.query("DELETE FROM channel_categories WHERE id=$1 AND server_id=$2", [categoryId, serverId]);
      if (!deleted.rowCount) throw notFound("Category not found");
      await writeAudit(client, serverId, request.auth.id, "category.deleted", {}, null, categoryId);
      return storeEvent(client, await serverRecipientIds(serverId, client), "category:removed", { id: categoryId, serverId });
    });
    publishStoredEvent(result); return { success: true };
  });

  app.post("/servers/:serverId/channels", { preHandler: requireAuth }, async (request, reply) => {
    const { serverId } = serverParams.parse(request.params); const body = channelCreateSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client); await requireServerPermission(serverId, request.auth.id, "manage_channels", client);
      if (body.categoryId) await requireCategory(serverId, body.categoryId, client);
      const id = newId(); const name = normalizeChannelName(body.name); await ensureChannelNameAvailable(serverId, name, null, client);
      const position = await nextPosition("channels", serverId, client);
      await client.query("INSERT INTO channels(id,server_id,category_id,kind,name,topic,position) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, serverId, body.categoryId, body.kind, name, body.topic, position]);
      await writeAudit(client, serverId, request.auth.id, "channel.created", { name, kind: body.kind }, null, id);
      const channel = await loadChannelSummary(id, request.auth.id, client);
      return { channel, event: await storeEvent(client, await channelRecipientIds(id, client), "channel:updated", channel) };
    });
    publishStoredEvent(result.event); return reply.status(201).send({ channel: result.channel });
  });

  app.patch("/servers/:serverId/channels/:channelId", { preHandler: requireAuth }, async (request) => {
    const { serverId, channelId } = channelParams.parse(request.params); const body = channelUpdateSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      await requireServerPermission(serverId, request.auth.id, "manage_channels", client);
      if (body.categoryId) await requireCategory(serverId, body.categoryId, client);
      const name = body.name === undefined ? null : normalizeChannelName(body.name);
      if (name) await ensureChannelNameAvailable(serverId, name, channelId, client);
      const updated = await client.query(
        `UPDATE channels SET name=coalesce($3,name),topic=coalesce($4,topic),
          category_id=CASE WHEN $5::boolean THEN $6::uuid ELSE category_id END,position=coalesce($7,position),updated_at=now()
         WHERE id=$1 AND server_id=$2 RETURNING id`,
        [channelId, serverId, name, body.topic ?? null, body.categoryId !== undefined, body.categoryId ?? null, body.position ?? null],
      );
      if (!updated.rowCount) throw notFound("Channel not found");
      await writeAudit(client, serverId, request.auth.id, "channel.updated", body, null, channelId);
      const channel = await loadChannelSummary(channelId, request.auth.id, client);
      return { channel, event: await storeEvent(client, await channelRecipientIds(channelId, client), "channel:updated", channel) };
    });
    publishStoredEvent(result.event); return { channel: result.channel };
  });

  app.delete("/servers/:serverId/channels/:channelId", { preHandler: requireAuth }, async (request) => {
    const { serverId, channelId } = channelParams.parse(request.params);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      await requireServerPermission(serverId, request.auth.id, "manage_channels", client);
      const channel = await client.query("SELECT id FROM channels WHERE id=$1 AND server_id=$2 FOR UPDATE", [channelId, serverId]);
      if (!channel.rowCount) throw notFound("Channel not found");
      const recipients = await channelRecipientIds(channelId, client);
      const callEvents = await deleteChannelStreams([channelId], client); await client.query("DELETE FROM channels WHERE id=$1", [channelId]);
      await writeAudit(client, serverId, request.auth.id, "channel.deleted", {}, null, channelId);
      return { event: await storeEvent(client, recipients, "channel:removed", { id: channelId, serverId }), callEvents };
    });
    publishStoredEvent(result.event); publishAll(result.callEvents); requestCallMediaDrain(app.log); return { success: true };
  });

  app.get("/servers/:serverId/channels/:channelId/overrides", { preHandler: requireAuth }, async (request) => {
    const { serverId, channelId } = channelParams.parse(request.params);
    await requireServerPermission(serverId, request.auth.id, "manage_roles");
    await requireChannel(serverId, channelId);
    return { items: await listChannelOverrides(channelId) };
  });

  app.put("/servers/:serverId/channels/:channelId/overrides/everyone", { preHandler: requireAuth }, async (request) => {
    const { serverId, channelId } = channelParams.parse(request.params);
    const body = channelPermissionOverrideSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      await requireServerPermission(serverId, request.auth.id, "manage_roles", client);
      await requireChannel(serverId, channelId, client);
      const before = await channelRecipientIds(channelId, client);
      await client.query(
        `INSERT INTO channel_everyone_permission_overrides(channel_id,allow_permissions,deny_permissions,updated_by)
         VALUES ($1,$2,$3,$4) ON CONFLICT(channel_id) DO UPDATE SET allow_permissions=EXCLUDED.allow_permissions,
         deny_permissions=EXCLUDED.deny_permissions,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [channelId, body.allow, body.deny, request.auth.id],
      );
      await writeAudit(client, serverId, request.auth.id, "channel.everyone-override.updated", body, null, channelId);
      return { item: mapChannelOverride(channelId, "everyone", serverId, body.allow, body.deny), events: await channelVisibilityEvents(channelId, serverId, before, client) };
    });
    publishAll(result.events); requestCallMediaDrain(app.log); return { item: result.item };
  });

  app.delete("/servers/:serverId/channels/:channelId/overrides/everyone", { preHandler: requireAuth }, async (request, reply) => {
    const { serverId, channelId } = channelParams.parse(request.params);
    const events = await transaction(async (client) => {
      await lockServer(serverId, client);
      await requireServerPermission(serverId, request.auth.id, "manage_roles", client);
      await requireChannel(serverId, channelId, client);
      const before = await channelRecipientIds(channelId, client);
      await client.query("DELETE FROM channel_everyone_permission_overrides WHERE channel_id=$1", [channelId]);
      await writeAudit(client, serverId, request.auth.id, "channel.everyone-override.removed", {}, null, channelId);
      return channelVisibilityEvents(channelId, serverId, before, client);
    });
    publishAll(events); requestCallMediaDrain(app.log); return reply.status(204).send();
  });

  app.put("/servers/:serverId/channels/:channelId/overrides/roles/:roleId", { preHandler: requireAuth }, async (request) => {
    const { serverId, channelId, roleId } = channelRoleOverrideParams.parse(request.params);
    const body = channelPermissionOverrideSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      const actor = await requireServerPermission(serverId, request.auth.id, "manage_roles", client);
      await requireChannel(serverId, channelId, client);
      const before = await channelRecipientIds(channelId, client);
      const role = await loadRoleForUpdate(serverId, roleId, client);
      if (!mayAssignRole(actor, role.position)) throw forbidden("You cannot override this role");
      await client.query(
        `INSERT INTO channel_role_permission_overrides(channel_id,role_id,allow_permissions,deny_permissions,updated_by)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT(channel_id,role_id) DO UPDATE
         SET allow_permissions=EXCLUDED.allow_permissions,deny_permissions=EXCLUDED.deny_permissions,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [channelId, roleId, body.allow, body.deny, request.auth.id],
      );
      await writeAudit(client, serverId, request.auth.id, "channel.role-override.updated", body, null, channelId);
      return { item: mapChannelOverride(channelId, "role", roleId, body.allow, body.deny), events: await channelVisibilityEvents(channelId, serverId, before, client) };
    });
    publishAll(result.events); requestCallMediaDrain(app.log); return { item: result.item };
  });

  app.delete("/servers/:serverId/channels/:channelId/overrides/roles/:roleId", { preHandler: requireAuth }, async (request, reply) => {
    const { serverId, channelId, roleId } = channelRoleOverrideParams.parse(request.params);
    const events = await transaction(async (client) => {
      await lockServer(serverId, client);
      const actor = await requireServerPermission(serverId, request.auth.id, "manage_roles", client);
      await requireChannel(serverId, channelId, client);
      const before = await channelRecipientIds(channelId, client);
      const role = await loadRoleForUpdate(serverId, roleId, client);
      if (!mayAssignRole(actor, role.position)) throw forbidden("You cannot override this role");
      await client.query("DELETE FROM channel_role_permission_overrides WHERE channel_id=$1 AND role_id=$2", [channelId, roleId]);
      await writeAudit(client, serverId, request.auth.id, "channel.role-override.removed", {}, null, channelId);
      return channelVisibilityEvents(channelId, serverId, before, client);
    });
    publishAll(events); requestCallMediaDrain(app.log); return reply.status(204).send();
  });

  app.put("/servers/:serverId/channels/:channelId/overrides/members/:userId", { preHandler: requireAuth }, async (request) => {
    const { serverId, channelId, userId } = channelMemberOverrideParams.parse(request.params);
    const body = channelPermissionOverrideSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      const actor = await requireServerPermission(serverId, request.auth.id, "manage_roles", client);
      await requireChannel(serverId, channelId, client);
      const before = await channelRecipientIds(channelId, client);
      const target = await serverAuthorization(serverId, userId, client);
      if (!mayManageMember(actor, target)) throw forbidden("You cannot override this server member");
      await client.query(
        `INSERT INTO channel_member_permission_overrides(channel_id,user_id,allow_permissions,deny_permissions,updated_by)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT(channel_id,user_id) DO UPDATE
         SET allow_permissions=EXCLUDED.allow_permissions,deny_permissions=EXCLUDED.deny_permissions,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [channelId, userId, body.allow, body.deny, request.auth.id],
      );
      await writeAudit(client, serverId, request.auth.id, "channel.member-override.updated", body, userId, channelId);
      return { item: mapChannelOverride(channelId, "member", userId, body.allow, body.deny), events: await channelVisibilityEvents(channelId, serverId, before, client) };
    });
    publishAll(result.events); requestCallMediaDrain(app.log); return { item: result.item };
  });

  app.delete("/servers/:serverId/channels/:channelId/overrides/members/:userId", { preHandler: requireAuth }, async (request, reply) => {
    const { serverId, channelId, userId } = channelMemberOverrideParams.parse(request.params);
    const events = await transaction(async (client) => {
      await lockServer(serverId, client);
      const actor = await requireServerPermission(serverId, request.auth.id, "manage_roles", client);
      await requireChannel(serverId, channelId, client);
      const before = await channelRecipientIds(channelId, client);
      const target = await serverAuthorization(serverId, userId, client);
      if (!mayManageMember(actor, target)) throw forbidden("You cannot override this server member");
      await client.query("DELETE FROM channel_member_permission_overrides WHERE channel_id=$1 AND user_id=$2", [channelId, userId]);
      await writeAudit(client, serverId, request.auth.id, "channel.member-override.removed", {}, userId, channelId);
      return channelVisibilityEvents(channelId, serverId, before, client);
    });
    publishAll(events); requestCallMediaDrain(app.log); return reply.status(204).send();
  });

  app.get("/servers/:serverId/members", { preHandler: requireAuth }, async (request) => {
    const { serverId } = serverParams.parse(request.params); await requireServerPermission(serverId, request.auth.id, "view_channels");
    const rows = await pool.query<PublicUserRow & { role: MemberRole; joined_at_ms: number; role_ids: string[]; viewer_blocked: boolean }>(
      `SELECT ${publicUserSelect},sm.role,(extract(epoch from sm.joined_at)*1000)::bigint::float8 joined_at_ms,
        coalesce(array_agg(smr.role_id) FILTER(WHERE smr.role_id IS NOT NULL),'{}') role_ids,
        EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=$2 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$2)) viewer_blocked
       FROM server_members sm JOIN users u ON u.id=sm.user_id
       LEFT JOIN server_member_roles smr ON smr.server_id=sm.server_id AND smr.user_id=sm.user_id
       WHERE sm.server_id=$1 AND u.deleted_at IS NULL GROUP BY sm.server_id,sm.user_id,u.id
       ORDER BY CASE sm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END,sm.joined_at`,
      [serverId, request.auth.id],
    );
    return { members: rows.rows.map((row) => ({ user: redactBlockedUser(mapUser(row), row.viewer_blocked), role: row.role, roleIds: row.role_ids, joinedAt: Number(row.joined_at_ms) })) };
  });

  app.post("/servers/:serverId/members", { preHandler: requireAuth }, async (request, reply) => {
    const { serverId } = serverParams.parse(request.params); const body = memberCreateSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      const actor = await requireServerPermission(serverId, request.auth.id, "manage_members", client);
      if (!mayAssignLegacyRole(actor, body.role)) throw forbidden("You cannot assign that member role");
      await validateAssignableRoles(serverId, body.roleIds, actor, client);
      if (body.userId === request.auth.id) throw conflict("This account is already a server member");
      await assertUsersCanInteract(request.auth.id, body.userId, "group_invites", client);
      const banned = await client.query("SELECT 1 FROM server_bans WHERE server_id=$1 AND user_id=$2", [serverId, body.userId]);
      if (banned.rowCount) throw forbidden("This account is banned from the server");
      const inserted = await client.query("INSERT INTO server_members(server_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id", [serverId, body.userId, body.role]);
      if (!inserted.rowCount) throw conflict("User is already a server member");
      await replaceMemberRoles(serverId, body.userId, body.roleIds, request.auth.id, client);
      await writeAudit(client, serverId, request.auth.id, "member.added", { role: body.role, roleIds: body.roleIds }, body.userId);
      const recipients = await serverRecipientIds(serverId, client);
      return storeEvent(client, recipients, "membership:updated", { serverId, userId: body.userId, state: "joined" });
    });
    publishStoredEvent(result); return reply.status(201).send({ success: true });
  });

  app.patch("/servers/:serverId/members/:userId", { preHandler: requireAuth }, async (request) => {
    const { serverId, userId } = memberParams.parse(request.params); const body = serverMemberUpdateSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      const actor = await requireServerPermission(serverId, request.auth.id, "manage_members", client);
      const target = await serverAuthorization(serverId, userId, client);
      if (!mayManageMember(actor, target)) throw forbidden("You cannot manage this server member");
      if (body.role && !mayAssignLegacyRole(actor, body.role)) throw forbidden("You cannot assign that member role");
      if (body.roleIds) await validateAssignableRoles(serverId, body.roleIds, actor, client);
      if (body.role) await client.query("UPDATE server_members SET role=$3 WHERE server_id=$1 AND user_id=$2", [serverId, userId, body.role]);
      if (body.roleIds) await replaceMemberRoles(serverId, userId, body.roleIds, request.auth.id, client);
      const callEvents = body.role || body.roleIds ? await terminateServerCalls(client, serverId, "permission-changed") : [];
      await writeAudit(client, serverId, request.auth.id, "member.updated", body, userId);
      return { event: await storeEvent(client, await serverRecipientIds(serverId, client), "membership:updated", { serverId, userId, state: "updated" }), callEvents };
    });
    publishStoredEvent(result.event); publishAll(result.callEvents); requestCallMediaDrain(app.log); return { success: true };
  });

  app.delete("/servers/:serverId/members/:userId", { preHandler: requireAuth }, async (request) => {
    const { serverId, userId } = memberParams.parse(request.params);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      if (userId === request.auth.id) {
        const self = await serverAuthorization(serverId, userId, client);
        if (self.role === "owner") throw forbidden("Transfer ownership before leaving the server");
      } else {
        const actor = await requireServerPermission(serverId, request.auth.id, "kick_members", client);
        const target = await serverAuthorization(serverId, userId, client);
        if (!mayManageMember(actor, target)) throw forbidden("You cannot remove this server member");
      }
      const callEvents = await terminateServerCalls(client, serverId, userId === request.auth.id ? "member-left" : "member-kicked");
      const deleted = await client.query("DELETE FROM server_members WHERE server_id=$1 AND user_id=$2 AND role<>'owner'", [serverId, userId]);
      if (!deleted.rowCount) throw notFound("Server member not found");
      await writeAudit(client, serverId, request.auth.id, userId === request.auth.id ? "member.left" : "member.kicked", {}, userId);
      const recipients = [userId, ...await serverRecipientIds(serverId, client)];
      return { event: await storeEvent(client, [...new Set(recipients)], "membership:updated", { serverId, userId, state: "removed" }), callEvents };
    });
    publishStoredEvent(result.event); publishAll(result.callEvents); requestCallMediaDrain(app.log); return { success: true };
  });

  app.get("/servers/:serverId/bans", { preHandler: requireAuth }, async (request) => {
    const { serverId } = serverParams.parse(request.params); await requireServerPermission(serverId, request.auth.id, "ban_members");
    const rows = await pool.query<PublicUserRow & { reason: string; banned_by: string | null; created_at_ms: number; viewer_blocked: boolean }>(
      `SELECT ${publicUserSelect},b.reason,b.banned_by,(extract(epoch from b.created_at)*1000)::bigint::float8 created_at_ms,
       EXISTS(SELECT 1 FROM user_blocks block WHERE (block.blocker_id=$2 AND block.blocked_id=u.id) OR (block.blocker_id=u.id AND block.blocked_id=$2)) viewer_blocked
       FROM server_bans b JOIN users u ON u.id=b.user_id WHERE b.server_id=$1 ORDER BY b.created_at DESC`, [serverId, request.auth.id],
    );
    return { bans: rows.rows.map((row) => ({ user: redactBlockedUser(mapUser(row), row.viewer_blocked), reason: row.reason, bannedBy: row.banned_by, createdAt: Number(row.created_at_ms) })) };
  });

  app.post("/servers/:serverId/bans/:userId", { preHandler: requireAuth }, async (request, reply) => {
    const { serverId, userId } = memberParams.parse(request.params); const body = serverBanSchema.parse(request.body ?? {});
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      const actor = await requireServerPermission(serverId, request.auth.id, "ban_members", client);
      if (userId === request.auth.id) throw conflict("You cannot ban yourself");
      const user = await client.query("SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL", [userId]); if (!user.rowCount) throw notFound("User not found");
      const membership = await client.query("SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2", [serverId, userId]);
      if (membership.rowCount) {
        const target = await serverAuthorization(serverId, userId, client);
        if (!mayManageMember(actor, target)) throw forbidden("You cannot ban this server member");
      }
      const inserted = await client.query(
        "INSERT INTO server_bans(server_id,user_id,banned_by,reason) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING user_id",
        [serverId, userId, request.auth.id, body.reason],
      );
      if (!inserted.rowCount) throw conflict("User is already banned");
      const callEvents = await terminateServerCalls(client, serverId, "member-banned");
      await client.query("DELETE FROM server_members WHERE server_id=$1 AND user_id=$2", [serverId, userId]);
      await writeAudit(client, serverId, request.auth.id, "member.banned", { reason: body.reason }, userId);
      return { event: await storeEvent(client, [userId, ...await serverRecipientIds(serverId, client)], "membership:updated", { serverId, userId, state: "removed" }), callEvents };
    });
    publishStoredEvent(result.event); publishAll(result.callEvents); requestCallMediaDrain(app.log); return reply.status(201).send({ success: true });
  });

  app.delete("/servers/:serverId/bans/:userId", { preHandler: requireAuth }, async (request) => {
    const { serverId, userId } = memberParams.parse(request.params);
    await transaction(async (client) => {
      await lockServer(serverId, client);
      await requireServerPermission(serverId, request.auth.id, "ban_members", client);
      const deleted = await client.query("DELETE FROM server_bans WHERE server_id=$1 AND user_id=$2", [serverId, userId]);
      if (!deleted.rowCount) throw notFound("Server ban not found");
      await writeAudit(client, serverId, request.auth.id, "member.unbanned", {}, userId);
    });
    return { success: true };
  });

  app.get("/servers/:serverId/roles", { preHandler: requireAuth }, async (request) => {
    const { serverId } = serverParams.parse(request.params); await requireServerPermission(serverId, request.auth.id, "view_channels");
    return { roles: await listRoles(serverId) };
  });

  app.post("/servers/:serverId/roles", { preHandler: requireAuth }, async (request, reply) => {
    const { serverId } = serverParams.parse(request.params); const body = serverRoleCreateSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client); const actor = await requireServerPermission(serverId, request.auth.id, "manage_roles", client);
      const maxPosition = Number((await client.query<{ value: number }>("SELECT coalesce(max(position),-1)+1 value FROM server_roles WHERE server_id=$1", [serverId])).rows[0]?.value ?? 0);
      const position = actor.role === "owner" ? Math.min(10_000, maxPosition) : Math.max(0, actor.highestCustomRolePosition - 1);
      if (!mayAssignRole(actor, position)) throw forbidden("You cannot create a role at this hierarchy level");
      await ensureRoleNameAvailable(serverId, body.name, null, client);
      const id = newId();
      await client.query("INSERT INTO server_roles(id,server_id,name,color,position,permissions,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, serverId, body.name, body.color, position, body.permissions, request.auth.id]);
      await writeAudit(client, serverId, request.auth.id, "role.created", { name: body.name, permissions: body.permissions }, null, id);
      const role = mapRole({ id, server_id: serverId, name: body.name, color: body.color, position, permissions: body.permissions });
      return { role, event: await storeEvent(client, await serverRecipientIds(serverId, client), "server-role:updated", role) };
    });
    publishStoredEvent(result.event); return reply.status(201).send({ role: result.role });
  });

  app.patch("/servers/:serverId/roles/:roleId", { preHandler: requireAuth }, async (request) => {
    const { serverId, roleId } = roleParams.parse(request.params); const body = serverRoleUpdateSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockServer(serverId, client);
      const actor = await requireServerPermission(serverId, request.auth.id, "manage_roles", client);
      const current = await loadRoleForUpdate(serverId, roleId, client);
      if (!mayAssignRole(actor, current.position)) throw forbidden("You cannot edit this role");
      if (body.position !== undefined && !mayAssignRole(actor, body.position)) throw forbidden("You cannot move this role above your own");
      if (body.name !== undefined) await ensureRoleNameAvailable(serverId, body.name, roleId, client);
      const updated = await client.query<RoleRow>(
        `UPDATE server_roles SET name=coalesce($3,name),color=CASE WHEN $4::boolean THEN $5::text ELSE color END,
          permissions=coalesce($6,permissions),position=coalesce($7,position),updated_at=now()
         WHERE id=$1 AND server_id=$2 RETURNING id,server_id,name,color,position,permissions`,
        [roleId, serverId, body.name ?? null, body.color !== undefined, body.color ?? null, body.permissions ?? null, body.position ?? null],
      );
      await writeAudit(client, serverId, request.auth.id, "role.updated", body, null, roleId);
      const callEvents = body.permissions !== undefined ? await terminateServerCalls(client, serverId, "permission-changed") : [];
      const role = mapRole(updated.rows[0]!);
      return { role, event: await storeEvent(client, await serverRecipientIds(serverId, client), "server-role:updated", role), callEvents };
    });
    publishStoredEvent(result.event); publishAll(result.callEvents); requestCallMediaDrain(app.log); return { role: result.role };
  });

  app.delete("/servers/:serverId/roles/:roleId", { preHandler: requireAuth }, async (request) => {
    const { serverId, roleId } = roleParams.parse(request.params);
    const event = await transaction(async (client) => {
      await lockServer(serverId, client);
      const actor = await requireServerPermission(serverId, request.auth.id, "manage_roles", client);
      const role = await loadRoleForUpdate(serverId, roleId, client);
      if (!mayAssignRole(actor, role.position)) throw forbidden("You cannot delete this role");
      await client.query("DELETE FROM server_roles WHERE id=$1 AND server_id=$2", [roleId, serverId]);
      const callEvents = await terminateServerCalls(client, serverId, "permission-changed");
      await writeAudit(client, serverId, request.auth.id, "role.deleted", { name: role.name }, null, roleId);
      return { event: await storeEvent(client, await serverRecipientIds(serverId, client), "server-role:removed", { id: roleId, serverId }), callEvents };
    });
    publishStoredEvent(event.event); publishAll(event.callEvents); requestCallMediaDrain(app.log); return { success: true };
  });

  app.get("/servers/:serverId/audit-log", { preHandler: requireAuth }, async (request) => {
    const { serverId } = serverParams.parse(request.params); const query = auditQuerySchema.parse(request.query);
    await requireServerPermission(serverId, request.auth.id, "view_audit_log");
    const rows = await pool.query<AuditRow>(
      `SELECT id::text,server_id,actor_id,action,target_user_id,target_entity_id,metadata,
        (extract(epoch from created_at)*1000)::bigint::float8 created_at_ms
       FROM server_audit_log WHERE server_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT $3`,
      [serverId, query.before ?? null, query.limit],
    );
    const items = rows.rows.map(mapAudit); const last = items.at(-1);
    return { items, nextCursor: items.length === query.limit ? last!.id : null };
  });
}

interface RoleRow { id: string; server_id: string; name: string; color: string | null; position: number; permissions: ServerPermission[] }
interface AuditRow { id: string; server_id: string; actor_id: string | null; action: string; target_user_id: string | null; target_entity_id: string | null; metadata: Record<string, unknown>; created_at_ms: number }

interface ChannelOverrideRow { channel_id: string; target_type: "everyone" | "role" | "member"; target_id: string; allow_permissions: ServerPermission[]; deny_permissions: ServerPermission[] }

async function listChannelOverrides(channelId: string, client: Pick<DbClient, "query"> = pool): Promise<ChannelPermissionOverride[]> {
  const rows = await client.query<ChannelOverrideRow>(
    `SELECT everyone.channel_id,'everyone'::text target_type,channel.server_id target_id,everyone.allow_permissions,everyone.deny_permissions
       FROM channel_everyone_permission_overrides everyone JOIN channels channel ON channel.id=everyone.channel_id WHERE everyone.channel_id=$1
     UNION ALL
     SELECT channel_id,'role'::text target_type,role_id target_id,allow_permissions,deny_permissions FROM channel_role_permission_overrides WHERE channel_id=$1
     UNION ALL
     SELECT channel_id,'member'::text,user_id,allow_permissions,deny_permissions FROM channel_member_permission_overrides WHERE channel_id=$1
     ORDER BY target_type,target_id`,
    [channelId],
  );
  return rows.rows.map((row) => mapChannelOverride(row.channel_id, row.target_type, row.target_id, row.allow_permissions, row.deny_permissions));
}

function mapChannelOverride(channelId: string, targetType: "everyone" | "role" | "member", targetId: string, allow: ServerPermission[], deny: ServerPermission[]): ChannelPermissionOverride {
  return { channelId, targetType, targetId, allow, deny };
}

function serializeAuthorization(value: ServerAuthorization) {
  return { role: value.role, permissions: [...value.permissions], rank: value.rank };
}

async function loadServerSummary(serverId: string, userId: string, client: Pick<DbClient, "query"> = pool) {
  const row = (await client.query<{ id: string; name: string; owner_id: string; icon_attachment_id: string | null; position: number }>(
    `SELECT s.id,s.name,s.owner_id,s.icon_attachment_id,sm.position FROM servers s JOIN server_members sm ON sm.server_id=s.id
     WHERE s.id=$1 AND sm.user_id=$2`, [serverId, userId],
  )).rows[0];
  if (!row) throw notFound("Server not found");
  return { id: row.id, name: row.name, iconUrl: row.icon_attachment_id ? `/api/v1/files/${row.icon_attachment_id}` : null, ownerId: row.owner_id, unread: false, mentionCount: 0, position: row.position };
}

async function loadChannelSummary(channelId: string, userId: string, client: Pick<DbClient, "query"> = pool) {
  const authorization = await channelAuthorization(channelId, userId, client);
  if (!authorization.permissions.has("view_channels")) throw forbidden("You do not have access to this channel");
  const row = (await client.query<{ id: string; server_id: string; category_id: string | null; kind: "text" | "voice"; name: string; topic: string; position: number }>(
    `SELECT ch.id,ch.server_id,ch.category_id,ch.kind,ch.name,ch.topic,ch.position FROM channels ch JOIN server_members sm ON sm.server_id=ch.server_id
     WHERE ch.id=$1 AND sm.user_id=$2`, [channelId, userId],
  )).rows[0];
  if (!row) throw notFound("Channel not found");
  return { id: row.id, serverId: row.server_id, categoryId: row.category_id, kind: row.kind, name: row.name, topic: row.topic, position: row.position, unreadCount: 0, mentionCount: 0, connectedMembers: [] };
}

async function requireOwnedImage(attachmentId: string, userId: string, client: Pick<DbClient, "query">, label: string) {
  const image = await client.query("SELECT 1 FROM attachments WHERE id=$1 AND owner_id=$2 AND kind='image' AND status IN ('processing','ready')", [attachmentId, userId]);
  if (!image.rowCount) throw forbidden(`${label} must be an image uploaded by this account`);
}

async function lockServer(serverId: string, client: Pick<DbClient, "query">) {
  const row = await client.query("SELECT id FROM servers WHERE id=$1 FOR UPDATE", [serverId]); if (!row.rowCount) throw notFound("Server not found");
}

async function requireChannel(serverId: string, channelId: string, client: Pick<DbClient, "query"> = pool) {
  const channel = await client.query("SELECT 1 FROM channels WHERE id=$1 AND server_id=$2", [channelId, serverId]);
  if (!channel.rowCount) throw notFound("Channel not found");
}

async function nextPosition(table: "channels" | "channel_categories", serverId: string, client: Pick<DbClient, "query">) {
  const row = await client.query<{ value: number }>(`SELECT coalesce(max(position),-1)+1 value FROM ${table} WHERE server_id=$1`, [serverId]);
  return Number(row.rows[0]?.value ?? 0);
}

async function requireCategory(serverId: string, categoryId: string, client: Pick<DbClient, "query">) {
  if (!(await client.query("SELECT 1 FROM channel_categories WHERE id=$1 AND server_id=$2", [categoryId, serverId])).rowCount) throw notFound("Category does not belong to this server");
}

async function ensureChannelNameAvailable(serverId: string, name: string, exceptId: string | null, client: Pick<DbClient, "query">) {
  if (!name) throw conflict("Channel name must contain at least one letter or number");
  const row = await client.query("SELECT 1 FROM channels WHERE server_id=$1 AND name=$2 AND ($3::uuid IS NULL OR id<>$3)", [serverId, name, exceptId]);
  if (row.rowCount) throw conflict("A channel with this name already exists");
}

async function ensureRoleNameAvailable(serverId: string, name: string, exceptId: string | null, client: Pick<DbClient, "query">) {
  const row = await client.query("SELECT 1 FROM server_roles WHERE server_id=$1 AND lower(name)=lower($2) AND ($3::uuid IS NULL OR id<>$3)", [serverId, name, exceptId]);
  if (row.rowCount) throw conflict("A server role with this name already exists");
}

async function serverRecipientIds(serverId: string, client: Pick<DbClient, "query">) {
  return (await client.query<{ user_id: string }>("SELECT user_id FROM server_members WHERE server_id=$1", [serverId])).rows.map((row) => row.user_id);
}

async function channelRecipientIds(channelId: string, client: Pick<DbClient, "query">) {
  return visibleChannelUserIds(channelId, client);
}

async function channelVisibilityEvents(channelId: string, serverId: string, before: string[], client: DbClient): Promise<StoredEvent[]> {
  const callEvents = await terminateChannelCalls(client, [channelId], "permission-changed");
  const after = await channelRecipientIds(channelId, client);
  const afterSet = new Set(after);
  const removed = before.filter((userId) => !afterSet.has(userId));
  const events: StoredEvent[] = [...callEvents];
  if (removed.length) events.push(await storeEvent(client, removed, "channel:removed", { id: channelId, serverId }));
  if (after.length) {
    const channel = await loadChannelSummary(channelId, after[0]!, client);
    events.push(await storeEvent(client, after, "channel:updated", channel));
  }
  return events;
}

async function validateAssignableRoles(serverId: string, roleIds: string[], actor: ServerAuthorization, client: Pick<DbClient, "query">) {
  if (!roleIds.length) return;
  const rows = await client.query<{ id: string; position: number }>("SELECT id,position FROM server_roles WHERE server_id=$1 AND id=ANY($2::uuid[])", [serverId, roleIds]);
  if (rows.rowCount !== roleIds.length) throw notFound("One or more server roles do not exist");
  if (rows.rows.some((role) => !mayAssignRole(actor, role.position))) throw forbidden("You cannot assign one or more of these roles");
}

async function replaceMemberRoles(serverId: string, userId: string, roleIds: string[], actorId: string, client: Pick<DbClient, "query">) {
  await client.query("DELETE FROM server_member_roles WHERE server_id=$1 AND user_id=$2", [serverId, userId]);
  if (roleIds.length) await client.query(
    `INSERT INTO server_member_roles(server_id,user_id,role_id,assigned_by)
     SELECT $1,$2,id,$4 FROM server_roles WHERE server_id=$1 AND id=ANY($3::uuid[])`, [serverId, userId, roleIds, actorId],
  );
}

async function listRoles(serverId: string, client: Pick<DbClient, "query"> = pool) {
  const rows = await client.query<RoleRow>("SELECT id,server_id,name,color,position,permissions FROM server_roles WHERE server_id=$1 ORDER BY position DESC,id", [serverId]);
  return rows.rows.map(mapRole);
}

async function loadRoleForUpdate(serverId: string, roleId: string, client: Pick<DbClient, "query">) {
  const row = (await client.query<RoleRow>("SELECT id,server_id,name,color,position,permissions FROM server_roles WHERE id=$1 AND server_id=$2 FOR UPDATE", [roleId, serverId])).rows[0];
  if (!row) throw notFound("Server role not found"); return row;
}

function mapRole(row: RoleRow): ServerRoleDefinition {
  return { id: row.id, serverId: row.server_id, name: row.name, color: row.color, position: row.position, permissions: row.permissions };
}

function mapAudit(row: AuditRow): ServerAuditEntry {
  return { id: row.id, serverId: row.server_id, actorId: row.actor_id, action: row.action, targetUserId: row.target_user_id, targetEntityId: row.target_entity_id, metadata: row.metadata, createdAt: Number(row.created_at_ms) };
}

async function writeAudit(client: Pick<DbClient, "query">, serverId: string, actorId: string | null, action: string, metadata: unknown, targetUserId: string | null = null, targetEntityId: string | null = null) {
  await client.query("INSERT INTO server_audit_log(server_id,actor_id,action,target_user_id,target_entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6)", [serverId, actorId, action, targetUserId, targetEntityId, metadata]);
}

async function deleteChannelStreams(ids: string[], client: DbClient): Promise<StoredEvent[]> {
  if (!ids.length) return [];
  const callEvents = await terminateChannelCalls(client, ids, "channel-deleted");
  await client.query("DELETE FROM messages WHERE stream_kind='channel' AND stream_id=ANY($1::uuid[])", [ids]);
  for (const table of ["read_states", "chat_drafts", "chat_folder_streams", "scheduled_messages", "stream_notification_settings"] as const) {
    await client.query(`DELETE FROM ${table} WHERE stream_kind='channel' AND stream_id=ANY($1::uuid[])`, [ids]);
  }
  return callEvents;
}

function publishAll(events: StoredEvent[]) { events.forEach(publishStoredEvent); }
function redactBlockedUser(user: ReturnType<typeof mapUser>, blocked: boolean) { return blocked ? { ...user, avatarUrl: null, bio: "", statusText: "", presence: "offline" as const, lastSeenAt: 0 } : user; }
export function normalizeChannelName(name: string) { return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_.-]+/gu, "").slice(0, 80); }
// Backward-compatible pure hierarchy helpers retained for release invariant
// tests and older server-management callers.
export function canManageRole(actor: MemberRole, target: MemberRole) { return actor === "owner" ? target !== "owner" : actor === "admin" ? target === "moderator" || target === "member" : false; }
export function canAssignRole(actor: MemberRole, desired: Exclude<MemberRole, "owner">) { return actor === "owner" || (actor === "admin" && desired !== "admin"); }
