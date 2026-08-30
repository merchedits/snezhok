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

import { attachmentAuthorizationSql, completeBody, fileLookupSql, fileQuery, idParams, initSchema, waitingGroupSchema, type UploadRow, type WaitingUploadRow } from "./uploadModel.js";
import { assertEmptyFinalizeBody, attachment, authorizedUpload, completeUpload, effectiveRangeHeader, etagMatches, orderedIdsEqual, ownedUpload, parseRange, resolveUploadPrincipal, singleHeader, uploadDeclarationMatches } from "./uploadService.js";

export { attachmentAuthorizationLegacySql, attachmentAuthorizationSql, capabilityUploadSelectSql, fileLookupSql } from "./uploadModel.js";
export { assertEmptyFinalizeBody, effectiveRangeHeader, parseRange, validUploadCapability } from "./uploadService.js";

export async function uploadRoutes(app: FastifyInstance) {
  // HttpURLConnection assigns this form content type to a zero-byte POST when
  // Android WorkManager finalizes an upload. The endpoint has no payload, but
  // Fastify still resolves a parser before entering the handler. Keep the
  // compatibility parser scoped to upload routes and reject any non-empty
  // payload in the finalize handler below.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
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
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),'waiting',to_timestamp($11/1000.0))`,
            [newId(), request.auth.id, access.streamKind, body.streamId, body.clientId, body.kind, body.text, body.replyToId, uploadIds, body.silent, expiresAt],
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
    assertEmptyFinalizeBody(request.body);
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
      await client.query("UPDATE attachments SET status='processing',updated_at=now() WHERE id=$1 AND owner_id=$2", [id, request.auth.id]);
      await client.query("SELECT publish_attachment_lifecycle($1)", [id]);
      return result.rowCount;
    });
    return { success: true, jobs: retried };
  });
}
