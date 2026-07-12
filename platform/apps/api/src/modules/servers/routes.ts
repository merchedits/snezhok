import type { FastifyInstance } from "fastify";
import { channelCreateSchema, serverCreateSchema } from "@snezhok/contracts";
import { z } from "zod";
import { pool, transaction } from "../../db/pool.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { requireAuth } from "../auth/middleware.js";
import { publishStoredEvent, storeEvent } from "../realtime/events.js";

const serverParams = z.object({ serverId: z.string().uuid() });
const memberParams = z.object({ serverId: z.string().uuid(), userId: z.string().uuid() });
const categorySchema = z.object({ name: z.string().trim().min(1).max(80) });
const memberSchema = z.object({ userId: z.string().uuid(), role: z.enum(["admin","moderator","member"]).default("member") });
const roleSchema = z.object({ role: z.enum(["admin","moderator","member"]) });

export async function serverRoutes(app: FastifyInstance) {
  app.post("/servers", { preHandler: requireAuth }, async (request, reply) => {
    const { name } = serverCreateSchema.parse(request.body);
    const id = newId(); const generalId = newId();
    const event = await transaction(async (client) => {
      await client.query("INSERT INTO servers(id,owner_id,name) VALUES ($1,$2,$3)", [id, request.auth.id, name]);
      await client.query("INSERT INTO server_members(server_id,user_id,role) VALUES ($1,$2,'owner')", [id, request.auth.id]);
      await client.query("INSERT INTO channels(id,server_id,kind,name,position) VALUES ($1,$2,'text','general',0)", [generalId, id]);
      return storeEvent(client, [request.auth.id], "server:updated", { id, name, iconUrl: null, ownerId: request.auth.id, unread: false, mentionCount: 0, position: 0 });
    });
    publishStoredEvent(event);
    return reply.status(201).send({ server: { id, name, iconUrl: null, ownerId: request.auth.id, unread: false, mentionCount: 0, position: 0 }, channelId: generalId });
  });

  app.post("/servers/:serverId/categories", { preHandler: requireAuth }, async (request, reply) => {
    const { serverId } = serverParams.parse(request.params); const { name } = categorySchema.parse(request.body);
    await requireManager(serverId, request.auth.id);
    const id = newId();
    const position = Number((await pool.query<{ position: number }>("SELECT coalesce(max(position),-1)+1 position FROM channel_categories WHERE server_id=$1", [serverId])).rows[0]!.position);
    await pool.query("INSERT INTO channel_categories(id,server_id,name,position) VALUES ($1,$2,$3,$4)", [id, serverId, name, position]);
    return reply.status(201).send({ category: { id, serverId, name, position, collapsed: false } });
  });

  app.post("/servers/:serverId/channels", { preHandler: requireAuth }, async (request, reply) => {
    const { serverId } = serverParams.parse(request.params); const body = channelCreateSchema.parse(request.body);
    await requireManager(serverId, request.auth.id);
    if (body.categoryId) {
      const category = await pool.query("SELECT 1 FROM channel_categories WHERE id=$1 AND server_id=$2", [body.categoryId, serverId]);
      if (!category.rowCount) throw notFound("Category does not belong to this server");
    }
    const id = newId();
    const position = Number((await pool.query<{ position: number }>("SELECT coalesce(max(position),-1)+1 position FROM channels WHERE server_id=$1", [serverId])).rows[0]!.position);
    const normalizedName = normalizeChannelName(body.name);
    await pool.query("INSERT INTO channels(id,server_id,category_id,kind,name,topic,position) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, serverId, body.categoryId, body.kind, normalizedName, body.topic, position]);
    return reply.status(201).send({ channel: { id, serverId, categoryId: body.categoryId, kind: body.kind, name: normalizedName, topic: body.topic, position, unreadCount: 0, mentionCount: 0, connectedMembers: [] } });
  });

  app.post("/servers/:serverId/members", { preHandler: requireAuth }, async (request, reply) => {
    const { serverId } = serverParams.parse(request.params); const body = memberSchema.parse(request.body);
    const actorRole = await memberRole(serverId, request.auth.id);
    if (!canAssignRole(actorRole, body.role)) throw forbidden("You cannot assign that role");
    const user = await pool.query("SELECT 1 FROM users WHERE id=$1", [body.userId]); if (!user.rowCount) throw notFound("User not found");
    const existingRole = await pool.query<{ role: ServerRole }>("SELECT role FROM server_members WHERE server_id=$1 AND user_id=$2", [serverId, body.userId]);
    if (existingRole.rows[0] && !canManageRole(actorRole, existingRole.rows[0].role)) throw forbidden("You cannot change this member");
    const membershipState = existingRole.rows[0] ? "updated" : "joined";
    const event = await transaction(async (client) => {
      await client.query("INSERT INTO server_members(server_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (server_id,user_id) DO UPDATE SET role=EXCLUDED.role", [serverId, body.userId, body.role]);
      const recipients = (await client.query<{ user_id: string }>("SELECT user_id FROM server_members WHERE server_id=$1", [serverId])).rows.map((row) => row.user_id);
      return storeEvent(client, recipients, "membership:updated", { serverId, userId: body.userId, state: membershipState });
    });
    publishStoredEvent(event);
    return reply.status(201).send({ success: true });
  });

  app.patch("/servers/:serverId/members/:userId", { preHandler: requireAuth }, async (request) => {
    const { serverId, userId } = memberParams.parse(request.params); const { role } = roleSchema.parse(request.body);
    const actorRole = await memberRole(serverId, request.auth.id); const targetRole = await memberRole(serverId, userId);
    if (!canManageRole(actorRole, targetRole) || !canAssignRole(actorRole, role)) throw forbidden("You cannot change this member's role");
    const result = await pool.query("UPDATE server_members SET role=$3 WHERE server_id=$1 AND user_id=$2 AND role<>'owner'", [serverId, userId, role]);
    if (!result.rowCount) throw notFound("Member not found"); return { success: true };
  });

  app.delete("/servers/:serverId/members/:userId", { preHandler: requireAuth }, async (request) => {
    const { serverId, userId } = memberParams.parse(request.params);
    if (userId !== request.auth.id) {
      const actorRole = await memberRole(serverId, request.auth.id); const targetRole = await memberRole(serverId, userId);
      if (!canManageRole(actorRole, targetRole)) throw forbidden("You cannot remove this member");
    }
    const result = await transaction(async (client) => {
      const deleted = await client.query("DELETE FROM server_members WHERE server_id=$1 AND user_id=$2 AND role<>'owner'", [serverId, userId]);
      if (!deleted.rowCount) throw forbidden("The owner cannot leave without transferring ownership");
      const recipients = [userId, ...(await client.query<{ user_id: string }>("SELECT user_id FROM server_members WHERE server_id=$1", [serverId])).rows.map((row) => row.user_id)];
      return storeEvent(client, recipients, "membership:updated", { serverId, userId, state: "removed" });
    });
    publishStoredEvent(result); return { success: true };
  });
}

async function requireManager(serverId: string, userId: string) {
  const result = await pool.query("SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2 AND role IN ('owner','admin')", [serverId, userId]);
  if (!result.rowCount) throw forbidden("Server management permission is required");
}
async function requireOwner(serverId: string, userId: string) {
  const result = await pool.query("SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2 AND role='owner'", [serverId, userId]);
  if (!result.rowCount) throw forbidden("Server ownership is required");
}

type ServerRole = "owner" | "admin" | "moderator" | "member";
async function memberRole(serverId: string, userId: string): Promise<ServerRole> {
  const result = await pool.query<{ role: ServerRole }>("SELECT role FROM server_members WHERE server_id=$1 AND user_id=$2", [serverId, userId]);
  if (!result.rows[0]) throw forbidden("Server membership is required"); return result.rows[0].role;
}
export function canManageRole(actor: ServerRole, target: ServerRole) { return actor === "owner" ? target !== "owner" : actor === "admin" ? target === "moderator" || target === "member" : false; }
export function canAssignRole(actor: ServerRole, desired: Exclude<ServerRole,"owner">) { return actor === "owner" || (actor === "admin" && desired !== "admin"); }
export function normalizeChannelName(name: string) { return name.trim().toLowerCase().replace(/\s+/g, "-"); }
