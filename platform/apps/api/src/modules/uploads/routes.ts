import { createReadStream } from "node:fs";
import { randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Attachment } from "@snezhok/contracts";
import { uploadMetadataSchema } from "@snezhok/contracts";
import { z } from "zod";
import { config } from "../../config.js";
import { pool, transaction } from "../../db/pool.js";
import { AppError, conflict, forbidden, notFound, unauthorized } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { getBearerOrCookie, requireAuth } from "../auth/middleware.js";
import { requireGlobalPermission } from "../admin/policy.js";
import { authenticateAccessToken, hashOpaqueToken } from "../auth/service.js";
import { appendChunk, detectTemporaryMimeType, ensureStorage, initializeTemporary, objectPath, removeObject, removeTemporary, stageObject, tempPath, writeWholeUpload } from "./storage.js";
import { stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { validateDetectedMedia, validateUploadDeclaration } from "./mediaValidation.js";
import { assertDirectConversationMessagingAllowed } from "../users/privacy.js";
import { resolveStreamAccess } from "../streams/access.js";
import {
  cancelWaitingDispatchForUploadSql,
  promoteReadyWaitingDispatchSql,
  validateWaitingDispatchShape,
  type WaitingUploadDeclaration,
} from "./waitingDispatch.js";

const initSchema = uploadMetadataSchema.extend({
  filename: z.string().trim().min(1).max(255).optional(), originalName: z.string().trim().min(1).max(255).optional(),
  mimeType: z.string().trim().min(1).max(255), bytes: z.number().int().positive().optional(), totalSize: z.number().int().positive().optional(),
}).refine((value) => Boolean(value.filename ?? value.originalName) && (value.bytes ?? value.totalSize) !== undefined, "Filename and size are required");
const idParams = z.object({ id: z.string().uuid() });
const fileQuery = z.object({ variant: z.string().uuid().optional() });
const completeBody = z.object({ uploadId: z.string().uuid() });
const waitingUploadSchema = uploadMetadataSchema.extend({
  uploadId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  bytes: z.number().int().positive(),
});
const waitingGroupSchema = z.object({
  streamId: z.string().uuid(),
  clientId: z.string().uuid(),
  kind: z.enum(["voice", "video-note", "media", "file"]),
  replyToId: z.string().uuid().nullable().default(null),
  silent: z.boolean().default(false),
  uploads: z.array(waitingUploadSchema).min(1).max(10),
  capabilityUploadIds: z.array(z.string().uuid()).max(10).optional(),
});
const CAPABILITY_HEADER = "upload-capability";

interface UploadRow {
  id: string;
  owner_id: string;
  filename: string;
  declared_bytes: string;
  received_bytes: string;
  quality: Attachment["quality"];
  kind: Attachment["kind"];
  media_purpose: "standard" | "voice" | "video-note";
  temp_key: string;
  status: string;
}

interface WaitingUploadRow extends UploadRow {
  declared_mime_type: string;
  strip_location: boolean;
  expires_at_ms: number;
}

type UploadPrincipal =
  | { kind: "owner"; userId: string }
  | { kind: "capability"; capabilityHash: string };

export const capabilityUploadSelectSql = `SELECT upload.id,upload.owner_id,upload.filename,upload.declared_bytes::text,upload.received_bytes::text,
        upload.quality,upload.kind,upload.media_purpose,upload.temp_key,upload.status
 FROM upload_sessions upload
 JOIN device_sessions session ON session.id=upload.device_session_id
 WHERE upload.id=$1 AND upload.capability_hash=$2 AND upload.expires_at>now()
   AND session.revoked_at IS NULL AND session.expires_at>now()`;

/**
 * A file is visible when it belongs to the requester, is an active profile
 * photo allowed by its owner's privacy policy (or its legacy thumbnail), an
 * avatar/icon for a joined group/server, or is attached to a non-deleted
 * message that is both visible to and readable by the requester. Keeping this
 * as one snapshot query avoids a time-of-check/time-of-use gap and an N+1
 * stream-access loop for attachments reused by forwarding.
 */
export const attachmentAuthorizationSql = `SELECT EXISTS(
  SELECT 1 FROM attachments requested
  WHERE requested.id=$1 AND (
    requested.owner_id=$2
    OR EXISTS (
      SELECT 1 FROM user_profile_photos profile
      JOIN attachments source ON source.id=profile.attachment_id
      JOIN user_privacy_settings privacy ON privacy.user_id=profile.user_id
      WHERE (profile.attachment_id=$1 OR source.thumbnail_attachment_id=$1)
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks block
          WHERE (block.blocker_id=$2 AND block.blocked_id=profile.user_id)
             OR (block.blocker_id=profile.user_id AND block.blocked_id=$2)
        )
        AND (
          privacy.profile_photos='everyone'
          OR (privacy.profile_photos='contacts' AND EXISTS (
            SELECT 1 FROM friendships friendship
            WHERE friendship.user_low_id=LEAST($2::uuid,profile.user_id)
              AND friendship.user_high_id=GREATEST($2::uuid,profile.user_id)
          ))
      )
    )
    OR EXISTS (
      SELECT 1 FROM conversations conversation
      JOIN conversation_members member ON member.conversation_id=conversation.id AND member.user_id=$2
      WHERE conversation.avatar_attachment_id=$1
    )
    OR EXISTS (
      SELECT 1 FROM servers server
      JOIN server_members member ON member.server_id=server.id AND member.user_id=$2
      WHERE server.icon_attachment_id=$1
        AND NOT EXISTS(SELECT 1 FROM server_bans ban WHERE ban.server_id=server.id AND ban.user_id=$2)
    )
    OR EXISTS (
      SELECT 1 FROM message_attachments link
      JOIN messages message ON message.id=link.message_id
      WHERE link.attachment_id=$1
        AND message.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM hidden_messages hidden
          WHERE hidden.user_id=$2 AND hidden.message_id=message.id
        )
        AND (
          (message.stream_kind='conversation' AND EXISTS (
            SELECT 1 FROM conversation_members member
            WHERE member.conversation_id=message.stream_id AND member.user_id=$2
          ))
          OR
          (message.stream_kind='channel' AND EXISTS (
            SELECT 1 FROM channels channel
            JOIN server_members member ON member.server_id=channel.server_id
            WHERE channel.id=message.stream_id AND member.user_id=$2
              AND NOT EXISTS(SELECT 1 FROM server_bans ban WHERE ban.server_id=channel.server_id AND ban.user_id=$2)
              AND (
                member.role='owner'
                OR coalesce((
                  SELECT override.allow_permissions @> ARRAY['view_channels']::text[]
                  FROM channel_member_permission_overrides override
                  WHERE override.channel_id=channel.id AND override.user_id=$2
                ),false)
                OR (
                  NOT coalesce((
                    SELECT override.deny_permissions @> ARRAY['view_channels']::text[]
                    FROM channel_member_permission_overrides override
                    WHERE override.channel_id=channel.id AND override.user_id=$2
                  ),false)
                  AND (
                    EXISTS (
                      SELECT 1 FROM channel_role_permission_overrides override
                      JOIN server_member_roles assigned ON assigned.role_id=override.role_id
                        AND assigned.server_id=channel.server_id AND assigned.user_id=$2
                      WHERE override.channel_id=channel.id
                        AND override.allow_permissions @> ARRAY['view_channels']::text[]
                    )
                    OR (
                      NOT EXISTS (
                        SELECT 1 FROM channel_role_permission_overrides override
                        JOIN server_member_roles assigned ON assigned.role_id=override.role_id
                          AND assigned.server_id=channel.server_id AND assigned.user_id=$2
                        WHERE override.channel_id=channel.id
                          AND override.deny_permissions @> ARRAY['view_channels']::text[]
                      )
                      AND (
                        coalesce((
                          SELECT override.allow_permissions @> ARRAY['view_channels']::text[]
                          FROM channel_everyone_permission_overrides override
                          WHERE override.channel_id=channel.id
                        ),false)
                        OR NOT coalesce((
                          SELECT override.deny_permissions @> ARRAY['view_channels']::text[]
                          FROM channel_everyone_permission_overrides override
                          WHERE override.channel_id=channel.id
                        ),false)
                      )
                    )
                  )
                )
              )
          ))
        )
    )
    OR EXISTS (
      SELECT 1 FROM cooperative_activity_attachments activity_link
      JOIN cooperative_activity_entries entry ON entry.id=activity_link.entry_id
      JOIN cooperative_activities activity ON activity.id=entry.activity_id
      JOIN cooperative_activity_participants participant ON participant.activity_id=activity.id AND participant.user_id=$2
      JOIN messages anchor ON anchor.id=activity.anchor_message_id
      WHERE activity_link.attachment_id=$1
        AND anchor.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM hidden_messages hidden WHERE hidden.user_id=$2 AND hidden.message_id=anchor.id)
        AND (
          activity.state='completed'
          OR (entry.created_by=$2 AND activity.type<>'memory-capsule')
          OR (activity.type='memory-capsule' AND activity.state='active' AND entry.created_by=$2)
          OR (activity.type='question' AND coalesce((activity.config->>'secret')::boolean,false)=false)
          OR activity.type IN ('movie-list','draw-guess','ideas-jar','milestone')
        )
    )
  )
) allowed`;

export const fileLookupSql = `SELECT a.owner_id,a.filename,coalesce(v.mime_type,a.mime_type) mime_type,coalesce(vb.storage_key,b.storage_key) storage_key,
         coalesce(v.bytes,a.bytes)::text bytes,coalesce(v.checksum_sha256,b.checksum_sha256) checksum_sha256,v.id variant_id,
         access_check.allowed
       FROM attachments a JOIN blobs b ON b.id=a.blob_id
       CROSS JOIN LATERAL (${attachmentAuthorizationSql}) access_check
       LEFT JOIN media_variants v ON v.attachment_id=a.id AND v.id=$3
       LEFT JOIN blobs vb ON vb.id=v.blob_id WHERE a.id=$1`;

export async function uploadRoutes(app: FastifyInstance) {
  await ensureStorage();

  app.post("/uploads/init", { preHandler: requireAuth }, async (request, reply) => {
    const body = initSchema.parse(request.body); const bytes = body.bytes ?? body.totalSize!;
    const id = newId(); const tempKey = `${id}.upload`;
    const capability = randomBytes(32).toString("base64url");
    const policy = await requireGlobalPermission(request.auth.id, "uploadFiles");
    validateUploadDeclaration({ kind: body.kind, purpose: body.purpose, mimeType: body.mimeType, bytes, filename: body.filename ?? body.originalName! }, Math.min(config.MAX_UPLOAD_BYTES, policy.maxUploadBytes));
    let result: { rows: Array<{ expires_at_ms: number }> };
    try {
      await initializeTemporary(tempKey);
      result = await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`upload-quota:${request.auth.id}`]);
        const effective = await requireGlobalPermission(request.auth.id, "uploadFiles", client);
        const usage = (await client.query<{ used: string | number }>(
          `SELECT coalesce((SELECT sum(bytes) FROM attachments WHERE owner_id=$1),0)+
                  coalesce((SELECT sum(declared_bytes) FROM upload_sessions WHERE owner_id=$1 AND status IN ('uploading','receiving','finalizing')),0) used`,
          [request.auth.id],
        )).rows[0];
        if (Number(usage?.used ?? 0) + bytes > effective.storageQuotaBytes) throw forbidden("Account storage quota exceeded");
        return client.query<{ expires_at_ms: number }>(
        `INSERT INTO upload_sessions(
           id,owner_id,filename,declared_mime_type,declared_bytes,quality,kind,strip_location,temp_key,media_purpose,
           expires_at,device_session_id,capability_hash
         )
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,LEAST(now()+interval '24 hours',session.expires_at),session.id,$12
         FROM device_sessions session
         WHERE session.id=$11 AND session.user_id=$2 AND session.revoked_at IS NULL AND session.expires_at>now()
         RETURNING (extract(epoch from expires_at)*1000)::bigint::float8 expires_at_ms`,
        [id, request.auth.id, body.filename ?? body.originalName, body.mimeType, bytes, body.quality, body.kind, body.stripLocation, tempKey, body.purpose, request.auth.sessionId, hashOpaqueToken(capability)]);
      });
    } catch (error) {
      await removeTemporary(tempKey).catch(() => undefined);
      throw error;
    }
    if (!result.rows[0]) {
      await removeTemporary(tempKey).catch(() => undefined);
      throw unauthorized("The device session is no longer active");
    }
    return reply.header("cache-control", "no-store").status(201).send({
      uploadId: id,
      upload: { id, offset: 0, chunkBytes: config.UPLOAD_CHUNK_BYTES, expiresAt: result.rows[0].expires_at_ms, capability },
    });
  });

  app.post("/uploads/message-group", { preHandler: requireAuth }, async (request, reply) => {
    const body = waitingGroupSchema.parse(request.body);
    const declarations = body.uploads as WaitingUploadDeclaration[];
    const requestedCapabilities = new Set(body.capabilityUploadIds ?? declarations.map((upload) => upload.uploadId));
    if (requestedCapabilities.size !== (body.capabilityUploadIds?.length ?? declarations.length)
      || [...requestedCapabilities].some((id) => !declarations.some((upload) => upload.uploadId === id))) {
      throw conflict("Capability upload IDs must be unique members of the attachment group");
    }
    try {
      validateWaitingDispatchShape(body.kind, declarations);
    } catch (error) {
      throw conflict(error instanceof Error ? error.message : "Invalid attachment group");
    }
    const policy = await requireGlobalPermission(request.auth.id, "uploadFiles");
    for (const upload of declarations) {
      validateUploadDeclaration(upload, Math.min(config.MAX_UPLOAD_BYTES, policy.maxUploadBytes));
    }

    const createdTemporaryKeys: string[] = [];
    try {
      const initialized = await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`attachment-group:${request.auth.id}:${body.clientId}`]);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`upload-quota:${request.auth.id}`]);
        for (const uploadId of [...declarations.map((upload) => upload.uploadId)].sort()) {
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`upload-session:${uploadId}`]);
        }
        const access = await resolveStreamAccess(request.auth.id, body.streamId, client);
        if (access.streamKind === "channel" && access.channelKind !== "text") throw forbidden("Messages cannot be sent to a voice channel");
        if (access.streamKind === "channel" && !access.serverPermissions.includes("send_messages")) throw forbidden("Message sending permission is required");
        if (access.streamKind === "channel" && !access.serverPermissions.includes("attach_files")) throw forbidden("File attachment permission is required");
        if (access.streamKind === "conversation") await assertDirectConversationMessagingAllowed(request.auth.id, body.streamId, client);
        if (body.replyToId) {
          const replyTarget = await client.query("SELECT 1 FROM messages WHERE id=$1 AND stream_kind=$2 AND stream_id=$3 AND deleted_at IS NULL", [body.replyToId, access.streamKind, body.streamId]);
          if (!replyTarget.rowCount) throw conflict("Reply target is not in this stream");
        }

        const existingDispatch = (await client.query<{
          id: string; stream_kind: string; stream_id: string; kind: string; reply_to_id: string | null;
          attachment_ids: string[]; silent: boolean; status: string;
        }>("SELECT id,stream_kind,stream_id,kind,reply_to_id,attachment_ids,silent,status FROM scheduled_messages WHERE user_id=$1 AND client_id=$2 FOR UPDATE", [request.auth.id, body.clientId])).rows[0];
        const uploadIds = declarations.map((upload) => upload.uploadId);
        if (existingDispatch && (
          existingDispatch.stream_kind !== access.streamKind || existingDispatch.stream_id !== body.streamId
          || existingDispatch.kind !== body.kind || existingDispatch.reply_to_id !== body.replyToId
          || existingDispatch.silent !== body.silent || !orderedIdsEqual(existingDispatch.attachment_ids, uploadIds)
        )) throw conflict("Client message ID was already used for another attachment group");
        if (existingDispatch && ["cancelled", "failed"].includes(existingDispatch.status)) throw conflict("Attachment dispatch is no longer active");

        const session = (await client.query<{ id: string; expires_at_ms: number }>(
          `SELECT id,(extract(epoch from expires_at)*1000)::bigint::float8 expires_at_ms
           FROM device_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`,
          [request.auth.sessionId, request.auth.id],
        )).rows[0];
        if (!session) throw unauthorized("The device session is no longer active");

        if (existingDispatch && ["pending", "delivering", "delivered"].includes(existingDispatch.status)) {
          const sessions = [] as Array<{
            uploadId: string; status: "complete"; attachment: Attachment; expiresAt: null; upload: null;
          }>;
          for (const uploadId of uploadIds) {
            sessions.push({ uploadId, status: "complete", attachment: await attachment(uploadId, client), expiresAt: null, upload: null });
          }
          return { sessions, dispatchStatus: existingDispatch.status === "delivered" ? "delivered" as const : "pending" as const };
        }

        const existingUploads = await client.query<WaitingUploadRow>(
          `SELECT id,owner_id,filename,declared_mime_type,declared_bytes::text,received_bytes::text,
             quality,kind,media_purpose,temp_key,status,strip_location,
             (extract(epoch from expires_at)*1000)::bigint::float8 expires_at_ms
           FROM upload_sessions WHERE id=ANY($1::uuid[]) FOR UPDATE`,
          [uploadIds],
        );
        const existingById = new Map(existingUploads.rows.map((upload) => [upload.id, upload]));
        const missing = declarations.filter((upload) => !existingById.has(upload.uploadId));
        const effective = await requireGlobalPermission(request.auth.id, "uploadFiles", client);
        const usage = (await client.query<{ used: string | number }>(
          `SELECT coalesce((SELECT sum(bytes) FROM attachments WHERE owner_id=$1),0)+
                  coalesce((SELECT sum(declared_bytes) FROM upload_sessions WHERE owner_id=$1 AND status IN ('uploading','receiving','finalizing')),0) used`,
          [request.auth.id],
        )).rows[0];
        const additionalBytes = missing.reduce((total, upload) => total + upload.bytes, 0);
        if (Number(usage?.used ?? 0) + additionalBytes > effective.storageQuotaBytes) throw forbidden("Account storage quota exceeded");

        const sessions: Array<{
          uploadId: string; status: "uploading" | "complete"; attachment: Awaited<ReturnType<typeof attachment>> | null;
          expiresAt: number | null;
          upload: { id: string; offset: number; chunkBytes: number; expiresAt: number; capability: string } | null;
        }> = [];
        for (const declaration of declarations) {
          const existing = existingById.get(declaration.uploadId);
          if (existing) {
            if (existing.owner_id !== request.auth.id || !uploadDeclarationMatches(existing, declaration)) throw conflict("Upload ID was already used with different metadata");
            if (existing.status === "complete") {
              sessions.push({ uploadId: existing.id, status: "complete", attachment: await attachment(existing.id, client), expiresAt: null, upload: null });
              continue;
            }
            if (existing.status === "finalizing") throw conflict("Upload is already being finalized");
            if (existing.status !== "uploading") throw conflict("Upload session is no longer resumable");
            if (!requestedCapabilities.has(existing.id)) {
              sessions.push({ uploadId: existing.id, status: "uploading", attachment: null, expiresAt: Number(existing.expires_at_ms), upload: null });
              continue;
            }
            const capability = randomBytes(32).toString("base64url");
            const renewed = (await client.query<{ expires_at_ms: number }>(
              `UPDATE upload_sessions SET device_session_id=$2,capability_hash=$3,
                 expires_at=LEAST(now()+interval '24 hours',(SELECT expires_at FROM device_sessions WHERE id=$2)),updated_at=now()
               WHERE id=$1 RETURNING (extract(epoch from expires_at)*1000)::bigint::float8 expires_at_ms`,
              [existing.id, session.id, hashOpaqueToken(capability)],
            )).rows[0]!;
            sessions.push({
              uploadId: existing.id, status: "uploading", attachment: null,
              expiresAt: Number(renewed.expires_at_ms),
              upload: { id: existing.id, offset: Number(existing.received_bytes), chunkBytes: config.UPLOAD_CHUNK_BYTES, expiresAt: Number(renewed.expires_at_ms), capability },
            });
            continue;
          }

          const tempKey = `${declaration.uploadId}.upload`;
          await initializeTemporary(tempKey);
          createdTemporaryKeys.push(tempKey);
          const capability = randomBytes(32).toString("base64url");
          const inserted = (await client.query<{ expires_at_ms: number }>(
            `INSERT INTO upload_sessions(
               id,owner_id,filename,declared_mime_type,declared_bytes,quality,kind,strip_location,temp_key,media_purpose,
               expires_at,device_session_id,capability_hash
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,LEAST(now()+interval '24 hours',(SELECT expires_at FROM device_sessions WHERE id=$11)),$11,$12)
             RETURNING (extract(epoch from expires_at)*1000)::bigint::float8 expires_at_ms`,
            [declaration.uploadId, request.auth.id, declaration.filename, declaration.mimeType, declaration.bytes, declaration.quality,
              declaration.kind, declaration.stripLocation, tempKey, declaration.purpose, session.id, hashOpaqueToken(capability)],
          )).rows[0]!;
          sessions.push({
            uploadId: declaration.uploadId, status: "uploading", attachment: null,
            expiresAt: Number(inserted.expires_at_ms),
            upload: { id: declaration.uploadId, offset: 0, chunkBytes: config.UPLOAD_CHUNK_BYTES, expiresAt: Number(inserted.expires_at_ms), capability },
          });
        }

        const expiresAt = Math.min(...sessions.flatMap((item) => item.expiresAt === null ? [] : [item.expiresAt]), session.expires_at_ms);
        if (!existingDispatch) {
          await client.query(
            `INSERT INTO scheduled_messages(
               id,user_id,stream_kind,stream_id,client_id,kind,text,reply_to_id,attachment_ids,silent,scheduled_for,status,expires_at
             ) VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8,$9,now(),'waiting',to_timestamp($10/1000.0))`,
            [newId(), request.auth.id, access.streamKind, body.streamId, body.clientId, body.kind, body.replyToId, uploadIds, body.silent, expiresAt],
          );
        } else if (existingDispatch.status === "waiting") {
          await client.query("UPDATE scheduled_messages SET expires_at=to_timestamp($3/1000.0),updated_at=now() WHERE user_id=$1 AND client_id=$2 AND status='waiting'", [request.auth.id, body.clientId, expiresAt]);
        }
        if (sessions.every((item) => item.status === "complete")) await client.query(promoteReadyWaitingDispatchSql, [sessions[0]!.uploadId]);
        return { sessions, dispatchStatus: existingDispatch?.status === "delivered" ? "delivered" : sessions.every((item) => item.status === "complete") ? "pending" : "waiting" };
      });
      createdTemporaryKeys.length = 0;
      return reply.header("cache-control", "no-store").status(201).send(initialized);
    } catch (error) {
      await Promise.all(createdTemporaryKeys.map((key) => removeTemporary(key).catch(() => undefined)));
      throw error;
    }
  });

  app.head("/uploads/:id", async (request, reply) => {
    const id = idParams.parse(request.params).id;
    const principal = await resolveUploadPrincipal(request);
    const upload = await authorizedUpload(principal, id);
    if (!["uploading", "receiving", "finalizing", "complete"].includes(upload.status)) throw conflict("Upload session is no longer active");
    return reply.headers({
      "upload-offset": upload.received_bytes,
      "upload-length": upload.declared_bytes,
      "upload-status": upload.status,
      "cache-control": "no-store",
    }).status(204).send();
  });

  app.patch("/uploads/:id/chunk", { bodyLimit: config.UPLOAD_CHUNK_BYTES + 1024 }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const principal = await resolveUploadPrincipal(request);
    const chunk = request.body;
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) throw conflict("Chunk body must be non-empty application/offset+octet-stream");
    const nextOffset = await transaction(async (client) => {
      const upload = await authorizedUpload(principal, id, client, true);
      if (upload.status !== "uploading") throw conflict("Upload no longer accepts chunks");
      const offset = Number(request.headers["upload-offset"]);
      if (!Number.isSafeInteger(offset) || offset !== Number(upload.received_bytes)) throw conflict(`Expected upload offset ${upload.received_bytes}`);
      if (offset + chunk.length > Number(upload.declared_bytes)) throw conflict("Chunk exceeds declared upload size");
      await appendChunk(upload.temp_key, offset, chunk);
      const next = offset + chunk.length;
      await client.query("UPDATE upload_sessions SET received_bytes=$2,updated_at=now() WHERE id=$1", [id, next]);
      return next;
    });
    return reply.header("upload-offset", nextOffset).status(204).send();
  });

  app.put("/uploads/:id/content", { bodyLimit: config.MAX_UPLOAD_BYTES + 1024 }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const principal = await resolveUploadPrincipal(request);
    const metadata = await authorizedUpload(principal, id);
    if (metadata.status !== "uploading" || Number(metadata.received_bytes) !== 0) throw conflict("Upload no longer accepts a complete file");
    const declaredBytes = Number(metadata.declared_bytes);
    const contentLength = Number(request.headers["content-length"]);
    if (!Number.isSafeInteger(contentLength) || contentLength !== declaredBytes) throw conflict(`Expected content length ${declaredBytes}`);
    const body = request.body;
    if (!body || typeof (body as Readable).pipe !== "function") throw conflict("File body must be application/octet-stream");
    const upload = await transaction(async (client) => {
      const locked = await authorizedUpload(principal, id, client, true);
      if (locked.status !== "uploading" || Number(locked.received_bytes) !== 0) throw conflict("Upload no longer accepts a complete file");
      const claimed = await client.query("UPDATE upload_sessions SET status='receiving',updated_at=now() WHERE id=$1 AND status='uploading' AND received_bytes=0", [id]);
      if (!claimed.rowCount) throw conflict("Upload changed before receiving the file");
      return locked;
    });
    try {
      await writeWholeUpload(upload.temp_key, body as Readable, declaredBytes);
    } catch (error) {
      await initializeTemporary(upload.temp_key).catch(() => undefined);
      const restored = await pool.query("UPDATE upload_sessions SET status='uploading',updated_at=now() WHERE id=$1 AND status='receiving'", [id]);
      if (!restored.rowCount) await removeTemporary(upload.temp_key).catch(() => undefined);
      throw conflict(error instanceof Error ? error.message : "Upload body could not be stored");
    }
    const finalized = await pool.query("UPDATE upload_sessions SET status='uploading',received_bytes=declared_bytes,updated_at=now() WHERE id=$1 AND status='receiving' AND received_bytes=0", [id]);
    if (!finalized.rowCount) {
      await removeTemporary(upload.temp_key).catch(() => undefined);
      throw conflict("Upload changed while receiving the file");
    }
    return reply.header("upload-offset", declaredBytes).status(204).send();
  });

  app.post("/uploads/:id/complete", async (request) => {
    const id = idParams.parse(request.params).id;
    return completeUpload(await resolveUploadPrincipal(request), id);
  });
  app.post("/uploads/complete", { preHandler: requireAuth }, async (request) => completeUpload(request.auth.id, completeBody.parse(request.body).uploadId));
  app.delete("/uploads/:id", async (request) => {
    const id = idParams.parse(request.params).id;
    const principal = await resolveUploadPrincipal(request);
    const upload = await transaction(async (client) => {
      const locked = await authorizedUpload(principal, id, client, true);
      if (locked.status === "cancelled") return locked;
      if (locked.status !== "uploading" && locked.status !== "receiving") throw conflict("Only an active upload can be cancelled");
      await client.query("UPDATE upload_sessions SET status='cancelled',updated_at=now() WHERE id=$1", [locked.id]);
      await client.query(cancelWaitingDispatchForUploadSql, [locked.id]);
      return locked;
    });
    await removeTemporary(upload.temp_key);
    return { success: true };
  });

  app.get("/files/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { variant } = fileQuery.parse(request.query);
    const result = await pool.query<{ owner_id: string; filename: string; mime_type: string; storage_key: string; bytes: string; checksum_sha256: string; variant_id: string | null; allowed: boolean }>(
      fileLookupSql, [id, request.auth.id, variant ?? null]);
    const file = result.rows[0]; if (!file) throw notFound("File not found");
    if (variant && !file.variant_id) throw notFound("Media variant not found");
    if (file.allowed !== true) throw forbidden("You cannot access this file");
    return sendFile(reply, file, request.headers);
  });

  function sendFile(reply: import("fastify").FastifyReply, file: { filename: string; mime_type: string; storage_key: string; bytes: string; checksum_sha256: string }, headers: IncomingHttpHeaders) {
    const totalBytes = Number(file.bytes);
    const etag = `"${file.checksum_sha256}"`;
    reply.header("content-type", file.mime_type).header("accept-ranges", "bytes").header("cache-control", "private, max-age=86400, immutable")
      .header("etag", etag).header("x-content-type-options", "nosniff").header("cross-origin-resource-policy", "same-site").header("content-security-policy", "default-src 'none'");
    const requestedRange = singleHeader(headers.range);
    if (!requestedRange && etagMatches(singleHeader(headers["if-none-match"]), etag)) return reply.status(304).send();
    const safeFilename = file.filename.replace(/[\r\n"]/g, "_"); reply.header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
    if (/(?:html|svg|xml|javascript)/i.test(file.mime_type)) reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
    const rangeHeader = effectiveRangeHeader(requestedRange, singleHeader(headers["if-range"]), etag);
    const range = parseRange(rangeHeader, totalBytes);
    if (range === "invalid") return reply.header("content-range", `bytes */${totalBytes}`).status(416).send();
    if (config.USE_X_ACCEL) return reply.header("x-accel-redirect", `${config.INTERNAL_MEDIA_PREFIX}${file.storage_key.replace(/^objects\//, "")}`).send();
    if (range) {
      reply.status(206).header("content-range", `bytes ${range.start}-${range.end}/${totalBytes}`).header("content-length", range.end-range.start+1);
      return reply.send(createReadStream(objectPath(file.storage_key), range));
    }
    return reply.header("content-length", totalBytes).send(createReadStream(objectPath(file.storage_key)));
  }

  app.delete("/media-jobs/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = idParams.parse(request.params);
    const result = await pool.query(
      `UPDATE media_jobs j SET cancel_requested_at=now(),status=CASE WHEN j.status='pending' THEN 'cancelled' ELSE j.status END,updated_at=now()
       FROM attachments a WHERE j.attachment_id=a.id AND a.id=$1 AND a.owner_id=$2 AND j.status IN ('pending','running')`,
      [id, request.auth.id],
    );
    if (!result.rowCount) throw notFound("Active media job not found");
    return { success: true };
  });

  app.post("/media-jobs/:id/retry", { preHandler: requireAuth }, async (request) => {
    const { id } = idParams.parse(request.params);
    const retried = await transaction(async (client) => {
      const result = await client.query(
        `UPDATE media_jobs j SET status='pending',attempts=0,available_at=now(),cancel_requested_at=NULL,locked_by=NULL,
           heartbeat_at=NULL,started_at=NULL,completed_at=NULL,error=NULL,updated_at=now()
         FROM attachments a WHERE j.attachment_id=a.id AND a.id=$1 AND a.owner_id=$2 AND j.status IN ('failed','cancelled')`,
        [id, request.auth.id],
      );
      if (!result.rowCount) throw notFound("Retryable media job not found");
      await client.query("UPDATE attachments SET status='processing' WHERE id=$1 AND owner_id=$2", [id, request.auth.id]);
      return result.rowCount;
    });
    return { success: true, jobs: retried };
  });
}

async function completeUpload(principalOrUserId: UploadPrincipal | string, uploadId: string) {
  const principal: UploadPrincipal = typeof principalOrUserId === "string"
    ? { kind: "owner", userId: principalOrUserId }
    : principalOrUserId;
  const upload = await transaction(async (client) => {
    const locked = await authorizedUpload(principal, uploadId, client, true);
    if (locked.status === "complete") return locked;
    if ((locked.status !== "uploading" && locked.status !== "finalizing") || Number(locked.received_bytes) !== Number(locked.declared_bytes)) throw conflict("Upload is incomplete");
    const info = await stat(tempPath(locked.temp_key)).catch(() => null);
    if (!info || !info.isFile() || info.size !== Number(locked.declared_bytes)) throw conflict("Uploaded bytes do not match the declared size");
    await client.query("UPDATE upload_sessions SET status='finalizing',updated_at=now() WHERE id=$1", [uploadId]);
    return { ...locked, status: "finalizing" };
  });
  if (upload.status === "complete") return { attachment: await attachment(upload.id) };
  let object: Awaited<ReturnType<typeof stageObject>>;
  try {
    const detectedMimeType = await detectTemporaryMimeType(upload.temp_key);
    validateDetectedMedia(upload.kind, upload.media_purpose, detectedMimeType);
    object = await stageObject(upload.temp_key);
  } catch (error) {
    const terminal = error instanceof AppError && error.status >= 400 && error.status < 500;
    await pool.query("UPDATE upload_sessions SET status=$2,updated_at=now() WHERE id=$1 AND status='finalizing'", [uploadId, terminal ? "cancelled" : "uploading"]);
    if (terminal) {
      await pool.query(cancelWaitingDispatchForUploadSql, [uploadId]);
      await removeTemporary(upload.temp_key).catch(() => undefined);
    }
    throw error;
  }
  if (object.bytes !== Number(upload.declared_bytes)) {
    await removeObject(object.storageKey).catch(() => undefined);
    await pool.query("UPDATE upload_sessions SET status='uploading',updated_at=now() WHERE id=$1 AND status='finalizing'", [uploadId]);
    throw conflict("Final object size does not match the upload");
  }
  const attachmentId = upload.id;
  const processMedia = canProcessMedia(upload.kind, upload.media_purpose, object.detectedMimeType);
  let adoptedStorageKey = object.storageKey;
  try {
    await transaction(async (client) => {
      const locked = await authorizedUpload(principal, uploadId, client, true);
      if (locked.status === "complete") return;
      if (locked.status !== "finalizing") throw conflict("Upload is not ready to finalize");
      const blob = await client.query<{ id: string; storage_key: string }>(
        `INSERT INTO blobs(id,checksum_sha256,storage_key,bytes,detected_mime_type) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (checksum_sha256) DO UPDATE SET checksum_sha256=EXCLUDED.checksum_sha256 RETURNING id,storage_key`,
        [newId(), object.checksum, object.storageKey, object.bytes, object.detectedMimeType]);
      adoptedStorageKey = blob.rows[0]!.storage_key;
      await client.query(
        `INSERT INTO attachments(id,owner_id,blob_id,filename,kind,mime_type,bytes,quality,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`, [attachmentId, locked.owner_id, blob.rows[0]!.id, upload.filename, upload.kind, object.detectedMimeType, object.bytes, upload.quality, processMedia ? "processing" : "ready"]);
      if (processMedia) {
        await client.query("INSERT INTO media_jobs(id,attachment_id,profile) SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM media_jobs WHERE attachment_id=$2 AND profile=$3)", [newId(), attachmentId, upload.quality]);
      }
      await client.query("UPDATE upload_sessions SET status='complete',checksum_sha256=$2,updated_at=now() WHERE id=$1", [uploadId, object.checksum]);
      await client.query(promoteReadyWaitingDispatchSql, [uploadId]);
    });
  } catch (error) {
    await removeObject(object.storageKey).catch(() => undefined);
    throw error;
  }
  if (adoptedStorageKey !== object.storageKey) await removeObject(object.storageKey).catch(() => undefined);
  await removeTemporary(upload.temp_key);
  return { attachment: await attachment(attachmentId) };
}

function orderedIdsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function uploadDeclarationMatches(upload: WaitingUploadRow, declaration: WaitingUploadDeclaration): boolean {
  return upload.filename === declaration.filename
    && upload.declared_mime_type === declaration.mimeType
    && Number(upload.declared_bytes) === declaration.bytes
    && upload.quality === declaration.quality
    && upload.kind === declaration.kind
    && upload.media_purpose === declaration.purpose
    && upload.strip_location === declaration.stripLocation;
}

function canProcessMedia(kind: Attachment["kind"], purpose: "standard" | "voice" | "video-note", mimeType: string) {
  if (kind === "document") return false;
  if (purpose === "voice") return mimeType.startsWith("audio/") || mimeType.startsWith("video/");
  if (purpose === "video-note") return mimeType.startsWith("video/");
  return mimeType.startsWith(`${kind}/`);
}

export function parseRange(header: string | undefined, totalBytes: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim()); if (!match || totalBytes <= 0) return "invalid";
  const startText = match[1] ?? ""; const endText = match[2] ?? "";
  if (!startText && !endText) return "invalid";
  let start: number; let end: number;
  if (!startText) { const suffix = Number(endText); if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid"; start = Math.max(0,totalBytes-suffix); end=totalBytes-1; }
  else { start=Number(startText); end=endText ? Number(endText) : totalBytes-1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || end<start || start>=totalBytes) return "invalid";
  return { start, end: Math.min(end,totalBytes-1) };
}

export function effectiveRangeHeader(range: string | undefined, ifRange: string | undefined, etag: string): string | undefined {
  if (!range || !ifRange) return range;
  return ifRange.trim() === etag ? range : undefined;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  return Boolean(header?.split(",").some((candidate) => candidate.trim() === etag || candidate.trim() === "*"));
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function validUploadCapability(value: string | string[] | undefined): string | null {
  const candidate = singleHeader(value)?.trim();
  // 32 random bytes encoded as unpadded base64url. Rejecting all other shapes
  // before hashing keeps malformed secrets out of database work and errors.
  return candidate && /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : null;
}

async function resolveUploadPrincipal(request: FastifyRequest): Promise<UploadPrincipal> {
  const capability = validUploadCapability(request.headers[CAPABILITY_HEADER]);
  if (capability) return { kind: "capability", capabilityHash: hashOpaqueToken(capability) };
  const token = getBearerOrCookie(request);
  if (!token) throw unauthorized();
  const authenticated = await authenticateAccessToken(token);
  request.auth = authenticated;
  return { kind: "owner", userId: authenticated.id };
}

async function authorizedUpload(
  principal: UploadPrincipal,
  id: string,
  client: Pick<import("../../db/pool.js").DbClient, "query"> = pool,
  forUpdate = false,
): Promise<UploadRow> {
  if (principal.kind === "owner") return ownedUpload(principal.userId, id, client, forUpdate);
  const result = await client.query<UploadRow>(
    `${capabilityUploadSelectSql} ${forUpdate ? "FOR UPDATE OF upload" : ""}`,
    [id, principal.capabilityHash],
  );
  if (!result.rows[0]) throw notFound("Upload session not found");
  return result.rows[0];
}

async function ownedUpload(userId: string, id: string, client: Pick<import("../../db/pool.js").DbClient, "query"> = pool, forUpdate = false) {
  const result = await client.query<UploadRow>(`SELECT id,owner_id,filename,declared_bytes::text,received_bytes::text,quality,kind,media_purpose,temp_key,status FROM upload_sessions WHERE id=$1 AND owner_id=$2 AND expires_at>now()${forUpdate ? " FOR UPDATE" : ""}`, [id, userId]);
  if (!result.rows[0]) throw notFound("Upload session not found"); return result.rows[0];
}

async function attachment(id: string, client: Pick<import("../../db/pool.js").DbClient, "query"> = pool): Promise<Attachment> {
  const row = (await client.query<{ id: string; owner_id: string; kind: Attachment["kind"]; filename: string; mime_type: string; bytes: string; width: number | null; height: number | null; duration_ms: number | null; quality: Attachment["quality"]; checksum_sha256: string; primary_id: string | null; primary_checksum: string | null; waveform: number[] | null; thumbnail_id: string | null; thumbnail_attachment_id: string | null }>(
    `SELECT a.id,a.owner_id,a.kind,a.filename,coalesce(p.mime_type,a.mime_type) mime_type,coalesce(p.bytes,a.bytes)::text bytes,
       coalesce(p.width,a.width) width,coalesce(p.height,a.height) height,coalesce(p.duration_ms,a.duration_ms) duration_ms,a.quality,b.checksum_sha256,
       p.id primary_id,p.checksum_sha256 primary_checksum,p.waveform,t.id thumbnail_id,a.thumbnail_attachment_id
     FROM attachments a JOIN blobs b ON b.id=a.blob_id
     LEFT JOIN LATERAL (SELECT * FROM media_variants WHERE attachment_id=a.id AND role='primary' ORDER BY created_at DESC LIMIT 1) p ON true
     LEFT JOIN LATERAL (SELECT * FROM media_variants WHERE attachment_id=a.id AND role='thumbnail' ORDER BY created_at DESC LIMIT 1) t ON true WHERE a.id=$1`, [id])).rows[0];
  if (!row) throw notFound("Attachment not found");
  return { id: row.id, ownerId: row.owner_id, kind: row.kind, filename: row.filename, mimeType: row.mime_type, bytes: Number(row.bytes), width: row.width, height: row.height, durationMs: row.duration_ms, quality: row.quality,
    url: row.primary_id ? `/api/v1/files/${row.id}?variant=${row.primary_id}` : `/api/v1/files/${row.id}`,
    originalUrl: `/api/v1/files/${row.id}`, thumbnailUrl: row.thumbnail_id ? `/api/v1/files/${row.id}?variant=${row.thumbnail_id}` : row.thumbnail_attachment_id ? `/api/v1/files/${row.thumbnail_attachment_id}` : null,
    checksum: row.checksum_sha256, ...(row.primary_checksum ? { primaryChecksum: row.primary_checksum } : {}), ...(row.waveform ? { waveform: row.waveform } : {}) };
}
