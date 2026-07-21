import type { FastifyInstance } from "fastify";
import { conversationCreateSchema, groupMemberRoleSchema, groupMemberSchema, groupUpdateSchema, ownershipTransferSchema } from "@snezhok/contracts";
import { z } from "zod";
import { pool, transaction, type DbClient } from "../../db/pool.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { requireAuth } from "../auth/middleware.js";
import { conversationSummary } from "../bootstrap/service.js";
import { publishStoredEvent, storeEvent } from "../realtime/events.js";
import { assertUsersCanInteract } from "../users/privacy.js";
import { mapUser, publicUserSelect, type PublicUserRow } from "../users/queries.js";
import { requireGlobalPermission } from "../admin/policy.js";
import { requestCallMediaDrain, revokeConversationParticipantMedia } from "../calls/mediaControl.js";

const params = z.object({ id: z.string().uuid() });
const memberParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
const preferencesSchema = z.object({
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  muted: z.boolean().optional(),
}).refine((value) => value.pinned !== undefined || value.archived !== undefined || value.muted !== undefined, { message: "At least one preference is required" });

export async function conversationRoutes(app: FastifyInstance) {
  app.post("/conversations", { preHandler: requireAuth }, async (request, reply) => {
    const body = conversationCreateSchema.parse(request.body);
    const participantIds = [...new Set([request.auth.id, ...body.participantIds])].sort();
    if (participantIds.length < 2) throw conflict("A conversation requires another participant");
    const kind = participantIds.length <= 2 ? "direct" : "group";
    const creation = await transaction(async (client) => {
      if (kind === "group") await requireGlobalPermission(request.auth.id, "createGroups", client);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dm:${participantIds.join(":")}`]);
      const users = await client.query<{ id: string }>("SELECT id FROM users WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL", [participantIds]);
      if (users.rowCount !== participantIds.length) throw notFound("One or more participants do not exist");
      for (const recipientId of participantIds) {
        if (recipientId !== request.auth.id) await assertUsersCanInteract(request.auth.id, recipientId, kind === "direct" ? "direct_messages" : "group_invites", client);
      }
      if (kind === "direct") {
        const existing = await client.query<{ id: string }>(
        `SELECT c.id FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id
         WHERE c.kind='direct' GROUP BY c.id HAVING array_agg(cm.user_id ORDER BY cm.user_id)=$1::uuid[] LIMIT 1`, [participantIds]);
        if (existing.rows[0]) return { id: existing.rows[0].id, created: false, event: null };
      }
      const id = newId();
      await client.query("INSERT INTO conversations(id,kind,title,owner_id) VALUES ($1,$2,$3,$4)", [id, kind, body.title ?? (kind === "group" ? "Group" : ""), request.auth.id]);
      for (const userId of participantIds) await client.query("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES ($1,$2,$3)", [id, userId, userId === request.auth.id ? "owner" : "member"]);
      const summaries = new Map<string, Awaited<ReturnType<typeof conversationSummary>>>();
      for (const participantId of participantIds) summaries.set(participantId, await conversationSummary(participantId, id, client));
      const event = await storeEvent(client, participantIds, "conversation:updated", (recipientId: string) => summaries.get(recipientId));
      return { id, created: true, event };
    });
    if (creation.event) publishStoredEvent(creation.event);
    const summary = await conversationSummary(request.auth.id, creation.id);
    return reply.status(creation.created ? 201 : 200).send({ conversation: summary });
  });
  app.patch("/conversations/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = params.parse(request.params); const body = groupUpdateSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockConversation(id, client);
      await requireGroupRole(id, request.auth.id, ["owner", "admin"], client);
      if (body.avatarAttachmentId) {
        const photo = await client.query("SELECT 1 FROM attachments WHERE id=$1 AND owner_id=$2 AND kind='image' AND status IN ('processing','ready')", [body.avatarAttachmentId, request.auth.id]);
        if (!photo.rowCount) throw forbidden("Group photo must be an image uploaded by this account");
      }
      const updated = await client.query(
        `UPDATE conversations SET title=coalesce($2,title),
          avatar_attachment_id=CASE WHEN $3::boolean THEN $4::uuid ELSE avatar_attachment_id END,updated_at=now()
         WHERE id=$1 AND kind='group'`,
        [id, body.title ?? null, body.avatarAttachmentId !== undefined, body.avatarAttachmentId ?? null],
      );
      if (!updated.rowCount) throw forbidden("You cannot rename this conversation");
      const participants = (await client.query<{ user_id: string }>("SELECT user_id FROM conversation_members WHERE conversation_id=$1", [id])).rows.map((row) => row.user_id);
      const summaries = new Map<string, Awaited<ReturnType<typeof conversationSummary>>>();
      for (const participantId of participants) summaries.set(participantId, await conversationSummary(participantId, id, client));
      const event = await storeEvent(client, participants, "conversation:updated", (recipient: string) => summaries.get(recipient));
      return { summary: summaries.get(request.auth.id)!, event };
    });
    publishStoredEvent(result.event); return { conversation: result.summary };
  });

  app.get("/conversations/:id/members", { preHandler: requireAuth }, async (request) => {
    const { id } = params.parse(request.params);
    await requireGroupRole(id, request.auth.id, ["owner", "admin", "member"]);
    const members = await pool.query<PublicUserRow & { role: "owner" | "admin" | "member"; joined_at_ms: number; viewer_blocked: boolean }>(
      `SELECT ${publicUserSelect},cm.role,(extract(epoch from cm.joined_at)*1000)::bigint::float8 joined_at_ms,
       EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=$2 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$2)) viewer_blocked
       FROM conversation_members cm JOIN users u ON u.id=cm.user_id
       WHERE cm.conversation_id=$1 AND u.deleted_at IS NULL ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,cm.joined_at`,
      [id, request.auth.id],
    );
    return { members: members.rows.map((row) => ({ user: redactBlockedUser(mapUser(row), row.viewer_blocked), role: row.role, joinedAt: Number(row.joined_at_ms) })) };
  });

  app.post("/conversations/:id/members", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = params.parse(request.params); const body = groupMemberSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockConversation(id, client);
      const actorRole = await requireGroupRole(id, request.auth.id, ["owner", "admin"], client);
      if (body.role === "admin" && actorRole !== "owner") throw forbidden("Only the group owner can add administrators");
      if (body.userId === request.auth.id) throw conflict("This account is already a group member");
      await assertUsersCanInteract(request.auth.id, body.userId, "group_invites", client);
      const count = Number((await client.query<{ count: string }>("SELECT count(*)::text count FROM conversation_members WHERE conversation_id=$1", [id])).rows[0]?.count ?? 0);
      if (count >= 100) throw conflict("A group can contain at most 100 members");
      const inserted = await client.query(
        "INSERT INTO conversation_members(conversation_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id",
        [id, body.userId, body.role],
      );
      if (!inserted.rowCount) throw conflict("User is already a group member");
      const recipients = await groupRecipientIds(id, client);
      const summaries = await groupSummaryEvents(id, recipients, client);
      return { summary: summaries.get(request.auth.id)!, event: await storeEvent(client, recipients, "conversation:updated", (recipient: string) => summaries.get(recipient)) };
    });
    publishStoredEvent(result.event);
    return reply.status(201).send({ conversation: result.summary });
  });

  app.patch("/conversations/:id/members/:userId", { preHandler: requireAuth }, async (request) => {
    const { id, userId } = memberParams.parse(request.params); const { role } = groupMemberRoleSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockConversation(id, client);
      const actorRole = await requireGroupRole(id, request.auth.id, ["owner", "admin"], client);
      const targetRole = await requireGroupRole(id, userId, ["admin", "member"], client);
      if (actorRole !== "owner" && (targetRole === "admin" || role === "admin")) throw forbidden("Only the group owner can manage administrators");
      await client.query("UPDATE conversation_members SET role=$3 WHERE conversation_id=$1 AND user_id=$2 AND role<>'owner'", [id, userId, role]);
      const recipients = await groupRecipientIds(id, client); const summaries = await groupSummaryEvents(id, recipients, client);
      return { event: await storeEvent(client, recipients, "conversation:updated", (recipient: string) => summaries.get(recipient)) };
    });
    publishStoredEvent(result.event); return { success: true };
  });

  app.delete("/conversations/:id/members/:userId", { preHandler: requireAuth }, async (request) => {
    const { id, userId } = memberParams.parse(request.params);
    const result = await transaction(async (client) => {
      await lockConversation(id, client);
      const actorRole = await requireGroupRole(id, request.auth.id, ["owner", "admin", "member"], client);
      const targetRole = await requireGroupRole(id, userId, ["admin", "member"], client);
      if (userId !== request.auth.id && actorRole !== "owner" && !(actorRole === "admin" && targetRole === "member")) throw forbidden("You cannot remove this group member");
      const callEvents = await revokeConversationParticipantMedia(client, id, userId, userId === request.auth.id ? "member-left" : "member-kicked");
      const removed = await client.query("DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND role<>'owner'", [id, userId]);
      if (!removed.rowCount) throw forbidden("The group owner must transfer ownership before leaving");
      const recipients = await groupRecipientIds(id, client); const summaries = await groupSummaryEvents(id, recipients, client);
      return { events: [
        ...callEvents,
        await storeEvent(client, [userId], "conversation:removed", { id }),
        ...(recipients.length ? [await storeEvent(client, recipients, "conversation:updated", (recipient: string) => summaries.get(recipient))] : []),
      ] };
    });
    result.events.forEach(publishStoredEvent); requestCallMediaDrain(app.log); return { success: true };
  });

  app.post("/conversations/:id/ownership", { preHandler: requireAuth }, async (request) => {
    const { id } = params.parse(request.params); const { userId } = ownershipTransferSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await lockConversation(id, client);
      await requireGroupRole(id, request.auth.id, ["owner"], client);
      if (userId === request.auth.id) throw conflict("This account already owns the group");
      await requireGroupRole(id, userId, ["admin", "member"], client);
      await client.query("UPDATE conversations SET owner_id=$2,updated_at=now() WHERE id=$1", [id, userId]);
      await client.query("UPDATE conversation_members SET role=CASE WHEN user_id=$2 THEN 'owner' ELSE 'admin' END WHERE conversation_id=$1 AND user_id=ANY($3::uuid[])", [id, userId, [request.auth.id, userId]]);
      const recipients = await groupRecipientIds(id, client); const summaries = await groupSummaryEvents(id, recipients, client);
      return { event: await storeEvent(client, recipients, "conversation:updated", (recipient: string) => summaries.get(recipient)) };
    });
    publishStoredEvent(result.event); return { success: true };
  });
  app.patch("/conversations/:id/preferences", { preHandler: requireAuth }, async (request) => {
    const { id } = params.parse(request.params);
    const body = preferencesSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const updated = await client.query(
        `UPDATE conversation_members cm SET
           pinned_at=CASE
             WHEN $3::boolean IS TRUE THEN now()
             WHEN $4::boolean IS TRUE OR $3::boolean IS FALSE THEN NULL
             ELSE pinned_at END,
           archived_at=CASE
             WHEN $4::boolean IS TRUE THEN now()
             WHEN $3::boolean IS TRUE OR $4::boolean IS FALSE THEN NULL
             ELSE archived_at END,
           muted_until=CASE
             WHEN $5::boolean IS TRUE THEN 'infinity'::timestamptz
             WHEN $5::boolean IS FALSE THEN NULL
             ELSE muted_until END
         FROM conversations c
         WHERE cm.conversation_id=$1 AND cm.user_id=$2 AND c.id=cm.conversation_id AND c.saved_owner_id IS NULL`,
        [id, request.auth.id, body.pinned ?? null, body.archived ?? null, body.muted ?? null],
      );
      if (!updated.rowCount) throw notFound("Conversation not found");
      const summary = await conversationSummary(request.auth.id, id, client);
      const event = await storeEvent(client, [request.auth.id], "conversation:updated", summary);
      return { summary, event };
    });
    publishStoredEvent(result.event);
    return { conversation: result.summary };
  });
  app.delete("/conversations/:id/members/me", { preHandler: requireAuth }, async (request) => {
    const { id } = params.parse(request.params);
    const result = await transaction(async (client) => {
      await lockConversation(id, client);
      const callEvents = await revokeConversationParticipantMedia(client, id, request.auth.id, "member-left");
      const result = await client.query(
        `DELETE FROM conversation_members cm USING conversations c
         WHERE cm.conversation_id=$1 AND cm.user_id=$2 AND c.id=cm.conversation_id AND c.saved_owner_id IS NULL
           AND (c.kind='direct' OR cm.role<>'owner') RETURNING c.kind`,
        [id, request.auth.id],
      );
      if (!result.rowCount) throw forbidden("The group owner must transfer ownership before leaving");
      const events = [...callEvents, await storeEvent(client, [request.auth.id], "conversation:removed", { id })];
      if (result.rows[0]?.kind === "group") {
        const recipients = await groupRecipientIds(id, client);
        if (recipients.length) {
          const summaries = await groupSummaryEvents(id, recipients, client);
          events.push(await storeEvent(client, recipients, "conversation:updated", (recipient: string) => summaries.get(recipient)));
        }
      }
      return events;
    });
    result.forEach(publishStoredEvent);
    requestCallMediaDrain(app.log);
    return { success: true };
  });
}

type GroupRole = "owner" | "admin" | "member";

async function requireGroupRole(id: string, userId: string, allowed: readonly GroupRole[], client: Pick<DbClient, "query"> = pool): Promise<GroupRole> {
  const result = await client.query<{ role: GroupRole }>(
    "SELECT cm.role FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id WHERE cm.conversation_id=$1 AND cm.user_id=$2 AND c.kind='group'",
    [id, userId],
  );
  const role = result.rows[0]?.role;
  if (!role || !allowed.includes(role)) throw forbidden("Group administration permission is required");
  return role;
}

async function groupRecipientIds(id: string, client: Pick<DbClient, "query">) {
  return (await client.query<{ user_id: string }>("SELECT user_id FROM conversation_members WHERE conversation_id=$1", [id])).rows.map((row) => row.user_id);
}

async function groupSummaryEvents(id: string, recipients: string[], client: Pick<DbClient, "query">) {
  const summaries = new Map<string, Awaited<ReturnType<typeof conversationSummary>>>();
  for (const recipient of recipients) summaries.set(recipient, await conversationSummary(recipient, id, client));
  return summaries;
}

async function lockConversation(id: string, client: Pick<DbClient, "query">) {
  const result = await client.query("SELECT id FROM conversations WHERE id=$1 FOR UPDATE", [id]);
  if (!result.rowCount) throw notFound("Conversation not found");
}

function redactBlockedUser(user: ReturnType<typeof mapUser>, blocked: boolean) {
  return blocked ? { ...user, avatarUrl: null, bio: "", statusText: "", presence: "offline" as const, lastSeenAt: 0 } : user;
}
