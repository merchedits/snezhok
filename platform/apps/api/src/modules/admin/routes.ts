import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { pool, transaction, type DbClient } from "../../db/pool.js";
import { AppError, conflict, forbidden, notFound } from "../../lib/errors.js";
import { requireGlobalAdmin } from "./middleware.js";
import { adminMemberPatchSchema, adminMembersQuerySchema, adminSettingsPatchSchema } from "./schemas.js";
import { globalPermissionNames, mergePermissions } from "./policy.js";
import { requestCallMediaDrain, terminateCallsForUser } from "../calls/mediaControl.js";
import { publishStoredEvent } from "../realtime/events.js";

const userParams = z.object({ userId: z.string().uuid() });
const auditQuery = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const mediaCommandParams = z.object({ id: z.coerce.number().int().positive() });

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/call-media-commands/failed", { preHandler: requireGlobalAdmin }, async () => {
    const result = await pool.query(
      `SELECT id::text,call_session_id,action,livekit_room,participant_identity,attempts,last_error_code,
              (extract(epoch from updated_at)*1000)::bigint::float8 updated_at_ms
       FROM call_media_commands WHERE status='failed' ORDER BY updated_at,id LIMIT 100`,
    );
    return { items: result.rows };
  });

  app.post("/admin/call-media-commands/:id/retry", { preHandler: requireGlobalAdmin }, async (request) => {
    const { id } = mediaCommandParams.parse(request.params);
    await transaction(async (client) => {
      const retried = await client.query(
        "UPDATE call_media_commands SET status='pending',attempts=0,available_at=now(),lease_until=NULL,completed_at=NULL,updated_at=now() WHERE id=$1 AND status='failed' RETURNING id",
        [id],
      );
      if (!retried.rowCount) throw notFound("Failed media-control command not found");
      await writeAudit(client, request.auth.id, "call_media_command.retried", null, { commandId: id });
    });
    requestCallMediaDrain(app.log);
    return { success: true };
  });

  app.get("/admin/settings", { preHandler: requireGlobalAdmin }, async () => ({ settings: await loadSettings() }));

  app.patch("/admin/settings", { preHandler: requireGlobalAdmin }, async (request) => {
    const body = adminSettingsPatchSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const current = (await client.query<{ revision: string | number; default_storage_quota_bytes: string | number; max_upload_bytes: string | number }>(
        "SELECT revision,default_storage_quota_bytes,max_upload_bytes FROM global_admin_settings WHERE singleton=true FOR UPDATE",
      )).rows[0];
      if (!current || Number(current.revision) !== body.revision) throw conflict("Administration settings changed on another device; reload and retry");
      const nextQuota = body.defaultStorageQuotaBytes ?? Number(current.default_storage_quota_bytes);
      const nextUploadLimit = body.maxUploadBytes ?? Number(current.max_upload_bytes);
      if (nextUploadLimit > nextQuota) throw new AppError(400, "VALIDATION_ERROR", "Maximum upload size cannot exceed the default storage quota", { maxUploadBytes: ["Must not exceed the default storage quota"] });
      if (nextUploadLimit > config.MAX_UPLOAD_BYTES) throw new AppError(400, "VALIDATION_ERROR", "Maximum upload size exceeds the server transport limit", { maxUploadBytes: [`Must not exceed ${config.MAX_UPLOAD_BYTES} bytes`] });
      const updated = await client.query(
        `UPDATE global_admin_settings SET
           default_permissions=coalesce($3::jsonb,default_permissions),
           default_storage_quota_bytes=coalesce($4,default_storage_quota_bytes),
           max_upload_bytes=coalesce($5,max_upload_bytes),
           message_retention_days=CASE WHEN $6::boolean THEN $7 ELSE message_retention_days END,
           orphan_media_retention_days=coalesce($8,orphan_media_retention_days),
           event_retention_days=coalesce($9,event_retention_days),
           feature_capabilities=coalesce($10::jsonb,feature_capabilities),
           revision=revision+1,updated_by=$1,updated_at=now()
         WHERE singleton=true AND revision=$2 RETURNING revision`,
        [request.auth.id, body.revision, body.defaultPermissions ?? null, body.defaultStorageQuotaBytes ?? null,
          body.maxUploadBytes ?? null, body.messageRetentionDays !== undefined, body.messageRetentionDays ?? null,
          body.orphanMediaRetentionDays ?? null, body.eventRetentionDays ?? null, body.featureCapabilities ?? null],
      );
      if (!updated.rowCount) throw conflict("Administration settings changed on another device; reload and retry");
      await writeAudit(client, request.auth.id, "settings.updated", null, { previousRevision: body.revision, fields: Object.keys(body).filter((key) => key !== "revision") });
      return loadSettings(client);
    });
    return { settings: result };
  });

  app.get("/admin/members", { preHandler: requireGlobalAdmin }, async (request) => {
    const query = adminMembersQuerySchema.parse(request.query);
    const rows = await pool.query<AdminMemberRow>(
      `SELECT u.id,u.username,u.display_name,u.is_admin,u.suspended_at,
              (extract(epoch from u.created_at)*1000)::bigint::float8 created_at_ms,
              coalesce(p.permission_overrides,'{}'::jsonb) permission_overrides,p.storage_quota_bytes,
              coalesce((SELECT sum(a.bytes) FROM attachments a WHERE a.owner_id=u.id),0)::bigint storage_used_bytes
         FROM users u
         LEFT JOIN user_admin_policies p ON p.user_id=u.id
        WHERE u.deleted_at IS NULL
          AND ($1='' OR u.username ILIKE '%'||$1||'%' OR u.display_name ILIKE '%'||$1||'%')
          AND ($2::uuid IS NULL OR (u.created_at,u.id)<(SELECT created_at,id FROM users WHERE id=$2))
        ORDER BY u.created_at DESC,u.id DESC LIMIT $3`,
      [query.q, query.cursor ?? null, query.limit + 1],
    );
    const hasMore = rows.rows.length > query.limit;
    const items = rows.rows.slice(0, query.limit).map(mapMember);
    return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
  });

  app.patch("/admin/members/:userId", { preHandler: requireGlobalAdmin }, async (request) => {
    const { userId } = userParams.parse(request.params);
    const body = adminMemberPatchSchema.parse(request.body);
    const result = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [492_001_732]);
      const current = (await client.query<{ is_admin: boolean; suspended: boolean }>(
        "SELECT is_admin,suspended_at IS NOT NULL suspended FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [userId],
      )).rows[0];
      if (!current) throw notFound("Member not found");
      if (userId === request.auth.id && (body.suspended === true || body.isAdmin === false)) throw forbidden("You cannot remove your own administrator access");
      if (current.is_admin && (body.isAdmin === false || body.suspended === true)) {
        const remaining = await client.query("SELECT 1 FROM users WHERE is_admin=true AND suspended_at IS NULL AND deleted_at IS NULL AND id<>$1 LIMIT 1", [userId]);
        if (!remaining.rowCount) throw conflict("At least one active administrator is required");
      }
      await client.query(
        `UPDATE users SET is_admin=coalesce($2,is_admin),
           suspended_at=CASE WHEN $3::boolean IS NULL THEN suspended_at WHEN $3 THEN coalesce(suspended_at,now()) ELSE NULL END,
           updated_at=now() WHERE id=$1`,
        [userId, body.isAdmin ?? null, body.suspended ?? null],
      );
      if (body.permissionOverrides !== undefined || body.storageQuotaBytes !== undefined) {
        const overrides = body.permissionOverrides === undefined ? null : Object.fromEntries(Object.entries(body.permissionOverrides).filter(([, value]) => value !== null));
        await client.query(
          `INSERT INTO user_admin_policies(user_id,permission_overrides,storage_quota_bytes,updated_by)
           VALUES ($1,coalesce($2::jsonb,'{}'::jsonb),$3,$4)
           ON CONFLICT(user_id) DO UPDATE SET
             permission_overrides=CASE WHEN $5::boolean THEN EXCLUDED.permission_overrides ELSE user_admin_policies.permission_overrides END,
             storage_quota_bytes=CASE WHEN $6::boolean THEN EXCLUDED.storage_quota_bytes ELSE user_admin_policies.storage_quota_bytes END,
             updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [userId, overrides, body.storageQuotaBytes ?? null, request.auth.id, body.permissionOverrides !== undefined, body.storageQuotaBytes !== undefined],
        );
      }
      if (body.suspended === true) {
        await client.query("UPDATE device_sessions SET revoked_at=now(),revoked_reason='account_suspended' WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
        // PostgreSQL delivers NOTIFY only after this transaction commits, so
        // sockets are never ejected for a member update that later rolls back.
        await client.query("SELECT pg_notify('snezhok_admin',$1)", [userId]);
      }
      const callEvents = body.suspended === true ? await terminateCallsForUser(client, userId, "account-suspended") : [];
      await writeAudit(client, request.auth.id, "member.updated", userId, { fields: Object.keys(body) });
      return { member: await loadMember(userId, client), callEvents };
    });
    result.callEvents.forEach(publishStoredEvent);
    if (result.callEvents.length) requestCallMediaDrain(app.log);
    return { member: result.member };
  });

  app.get("/admin/audit", { preHandler: requireGlobalAdmin }, async (request) => {
    const query = auditQuery.parse(request.query);
    const result = await pool.query<{ id: string; actor_id: string | null; action: string; target_user_id: string | null; metadata: Record<string, unknown>; created_at_ms: number }>(
      `SELECT id::text,actor_id,action,target_user_id,metadata,(extract(epoch from created_at)*1000)::bigint::float8 created_at_ms
       FROM global_admin_audit_log WHERE ($1::bigint IS NULL OR id<$1) ORDER BY id DESC LIMIT $2`,
      [query.before ?? null, query.limit],
    );
    return { items: result.rows.map((row) => ({ id: row.id, actorId: row.actor_id, action: row.action, targetUserId: row.target_user_id, metadata: row.metadata, createdAt: row.created_at_ms })) };
  });
}

interface SettingsRow { revision: string | number; default_permissions: Record<string, boolean>; default_storage_quota_bytes: string | number; max_upload_bytes: string | number; message_retention_days: number | null; orphan_media_retention_days: number; event_retention_days: number; feature_capabilities: { uploads: boolean; calls: boolean; activities: boolean; servers: boolean }; updated_at_ms: number }
async function loadSettings(client: Pick<DbClient, "query"> = pool) {
  const row = (await client.query<SettingsRow>(`SELECT revision,default_permissions,default_storage_quota_bytes,max_upload_bytes,message_retention_days,
    orphan_media_retention_days,event_retention_days,feature_capabilities,(extract(epoch from updated_at)*1000)::bigint::float8 updated_at_ms FROM global_admin_settings WHERE singleton=true`)).rows[0]!;
  return { revision: Number(row.revision), defaultPermissions: mergePermissions(row.default_permissions, {}), defaultStorageQuotaBytes: Number(row.default_storage_quota_bytes), maxUploadBytes: Number(row.max_upload_bytes), messageRetentionDays: row.message_retention_days, orphanMediaRetentionDays: row.orphan_media_retention_days, eventRetentionDays: row.event_retention_days, featureCapabilities: row.feature_capabilities, updatedAt: row.updated_at_ms };
}

interface AdminMemberRow { id: string; username: string; display_name: string; is_admin: boolean; suspended_at: Date | null; created_at_ms: number; permission_overrides: Record<string, boolean>; storage_quota_bytes: string | number | null; storage_used_bytes: string | number }
const mapMember = (row: AdminMemberRow) => ({ id: row.id, username: row.username, displayName: row.display_name, isAdmin: row.is_admin, suspended: Boolean(row.suspended_at), createdAt: row.created_at_ms, permissionOverrides: sanitizeOverrides(row.permission_overrides), storageQuotaBytes: row.storage_quota_bytes === null ? null : Number(row.storage_quota_bytes), storageUsedBytes: Number(row.storage_used_bytes) });
function sanitizeOverrides(value: Record<string, boolean>) { return Object.fromEntries(globalPermissionNames.flatMap((name) => typeof value?.[name] === "boolean" ? [[name, value[name]]] : [])); }
async function loadMember(userId: string, client: Pick<DbClient, "query">) {
  const row = (await client.query<AdminMemberRow>(`SELECT u.id,u.username,u.display_name,u.is_admin,u.suspended_at,
    (extract(epoch from u.created_at)*1000)::bigint::float8 created_at_ms,coalesce(p.permission_overrides,'{}'::jsonb) permission_overrides,p.storage_quota_bytes,
    coalesce((SELECT sum(a.bytes) FROM attachments a WHERE a.owner_id=u.id),0)::bigint storage_used_bytes
    FROM users u LEFT JOIN user_admin_policies p ON p.user_id=u.id WHERE u.id=$1`, [userId])).rows[0];
  if (!row) throw notFound("Member not found");
  return mapMember(row);
}
async function writeAudit(client: Pick<DbClient, "query">, actorId: string, action: string, targetUserId: string | null, metadata: Record<string, unknown>) {
  await client.query("INSERT INTO global_admin_audit_log(actor_id,action,target_user_id,metadata) VALUES ($1,$2,$3,$4)", [actorId, action, targetUserId, metadata]);
}
