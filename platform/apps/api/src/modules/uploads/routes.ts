import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { Attachment } from "@snezhok/contracts";
import { uploadMetadataSchema } from "@snezhok/contracts";
import { z } from "zod";
import { config } from "../../config.js";
import { pool, transaction } from "../../db/pool.js";
import { AppError, conflict, forbidden, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { requireAuth } from "../auth/middleware.js";
import { resolveStreamAccess } from "../streams/access.js";
import { appendChunk, ensureStorage, initializeTemporary, objectPath, removeTemporary, stageObject, tempPath, writeWholeUpload } from "./storage.js";
import { stat } from "node:fs/promises";
import type { Readable } from "node:stream";

const initSchema = uploadMetadataSchema.extend({
  filename: z.string().trim().min(1).max(255).optional(), originalName: z.string().trim().min(1).max(255).optional(),
  mimeType: z.string().trim().min(1).max(255), bytes: z.number().int().nonnegative().optional(), totalSize: z.number().int().nonnegative().optional(),
}).refine((value) => Boolean(value.filename ?? value.originalName) && (value.bytes ?? value.totalSize) !== undefined, "Filename and size are required");
const idParams = z.object({ id: z.string().uuid() });
const fileQuery = z.object({ variant: z.string().uuid().optional() });
const completeBody = z.object({ uploadId: z.string().uuid() });

export async function uploadRoutes(app: FastifyInstance) {
  await ensureStorage();

  app.post("/uploads/init", { preHandler: requireAuth }, async (request, reply) => {
    const body = initSchema.parse(request.body); const bytes = body.bytes ?? body.totalSize!;
    if (bytes > config.MAX_UPLOAD_BYTES) throw new AppError(413, "UPLOAD_TOO_LARGE", "Upload exceeds the configured limit");
    const id = newId(); const tempKey = `${id}.upload`;
    await initializeTemporary(tempKey);
    const result = await pool.query<{ expires_at_ms: number }>(
      `INSERT INTO upload_sessions(id,owner_id,filename,declared_mime_type,declared_bytes,quality,kind,strip_location,temp_key,media_purpose,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '24 hours') RETURNING (extract(epoch from expires_at)*1000)::bigint::float8 expires_at_ms`,
      [id, request.auth.id, body.filename ?? body.originalName, body.mimeType, bytes, body.quality, body.kind, body.stripLocation, tempKey, body.purpose]);
    return reply.status(201).send({ uploadId: id, upload: { id, offset: 0, chunkBytes: config.UPLOAD_CHUNK_BYTES, expiresAt: result.rows[0]!.expires_at_ms } });
  });

  app.head("/uploads/:id", { preHandler: requireAuth }, async (request, reply) => {
    const upload = await ownedUpload(request.auth.id, idParams.parse(request.params).id);
    return reply.headers({ "upload-offset": upload.received_bytes, "upload-length": upload.declared_bytes, "cache-control": "no-store" }).status(204).send();
  });

  app.patch("/uploads/:id/chunk", { preHandler: requireAuth, bodyLimit: config.UPLOAD_CHUNK_BYTES + 1024 }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const chunk = request.body;
    if (!Buffer.isBuffer(chunk)) throw conflict("Chunk body must be application/offset+octet-stream");
    const nextOffset = await transaction(async (client) => {
      const upload = await ownedUpload(request.auth.id, id, client, true);
      if (upload.status !== "uploading") throw conflict("Upload no longer accepts chunks");
      const offset = Number(request.headers["upload-offset"]);
      if (!Number.isSafeInteger(offset) || offset !== Number(upload.received_bytes)) throw conflict(`Expected upload offset ${upload.received_bytes}`);
      if (offset + chunk.length > Number(upload.declared_bytes)) throw conflict("Chunk exceeds declared upload size");
      await appendChunk(upload.temp_key, offset, chunk);
      const next = offset + chunk.length;
      await client.query("UPDATE upload_sessions SET received_bytes=$3,updated_at=now() WHERE id=$1 AND owner_id=$2", [id, request.auth.id, next]);
      return next;
    });
    return reply.header("upload-offset", nextOffset).status(204).send();
  });

  app.put("/uploads/:id/content", { preHandler: requireAuth, bodyLimit: config.MAX_UPLOAD_BYTES + 1024 }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const upload = await ownedUpload(request.auth.id, id);
    if (upload.status !== "uploading" || Number(upload.received_bytes) !== 0) throw conflict("Upload no longer accepts a complete file");
    const declaredBytes = Number(upload.declared_bytes);
    const contentLength = Number(request.headers["content-length"]);
    if (!Number.isSafeInteger(contentLength) || contentLength !== declaredBytes) throw conflict(`Expected content length ${declaredBytes}`);
    const body = request.body;
    if (!body || typeof (body as Readable).pipe !== "function") throw conflict("File body must be application/octet-stream");
    try {
      await writeWholeUpload(upload.temp_key, body as Readable, declaredBytes);
    } catch (error) {
      await initializeTemporary(upload.temp_key).catch(() => undefined);
      throw conflict(error instanceof Error ? error.message : "Upload body could not be stored");
    }
    await transaction(async (client) => {
      const locked = await ownedUpload(request.auth.id, id, client, true);
      if (locked.status !== "uploading" || Number(locked.received_bytes) !== 0) throw conflict("Upload changed while receiving the file");
      await client.query("UPDATE upload_sessions SET received_bytes=declared_bytes,updated_at=now() WHERE id=$1 AND owner_id=$2", [id, request.auth.id]);
    });
    return reply.header("upload-offset", declaredBytes).status(204).send();
  });

  app.post("/uploads/:id/complete", { preHandler: requireAuth }, async (request) => completeUpload(request.auth.id, idParams.parse(request.params).id));
  app.post("/uploads/complete", { preHandler: requireAuth }, async (request) => completeUpload(request.auth.id, completeBody.parse(request.body).uploadId));
  app.delete("/uploads/:id", { preHandler: requireAuth }, async (request) => {
    const upload = await transaction(async (client) => {
      const locked = await ownedUpload(request.auth.id, idParams.parse(request.params).id, client, true);
      if (locked.status !== "uploading") throw conflict("Only an active upload can be cancelled");
      await client.query("UPDATE upload_sessions SET status='cancelled',updated_at=now() WHERE id=$1", [locked.id]); return locked;
    });
    await removeTemporary(upload.temp_key);
    return { success: true };
  });

  app.get("/files/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { variant } = fileQuery.parse(request.query);
    const result = await pool.query<{ owner_id: string; filename: string; mime_type: string; storage_key: string; bytes: string; variant_id: string | null }>(
      `SELECT a.owner_id,a.filename,coalesce(v.mime_type,a.mime_type) mime_type,coalesce(vb.storage_key,b.storage_key) storage_key,
         coalesce(v.bytes,a.bytes)::text bytes,v.id variant_id FROM attachments a JOIN blobs b ON b.id=a.blob_id
       LEFT JOIN media_variants v ON v.attachment_id=a.id AND v.id=$2 LEFT JOIN blobs vb ON vb.id=v.blob_id WHERE a.id=$1`, [id, variant ?? null]);
    const file = result.rows[0]; if (!file) throw notFound("File not found");
    if (variant && !file.variant_id) throw notFound("Media variant not found");
    if (file.owner_id !== request.auth.id) {
      const profilePhoto = await pool.query(
        `SELECT 1 FROM user_profile_photos p JOIN attachments a ON a.id=p.attachment_id
         WHERE p.attachment_id=$1 OR a.thumbnail_attachment_id=$1 LIMIT 1`,
        [id],
      );
      if (profilePhoto.rowCount) {
        return sendFile(reply, file, request.headers.range);
      }
      const links = await pool.query<{ stream_id: string }>("SELECT m.stream_id FROM message_attachments ma JOIN messages m ON m.id=ma.message_id WHERE ma.attachment_id=$1", [id]);
      let allowed = false;
      for (const link of links.rows) { try { await resolveStreamAccess(request.auth.id, link.stream_id); allowed = true; break; } catch { /* try another linked stream */ } }
      if (!allowed) throw forbidden("You cannot access this file");
    }
    return sendFile(reply, file, request.headers.range);
  });

  function sendFile(reply: import("fastify").FastifyReply, file: { filename: string; mime_type: string; storage_key: string; bytes: string }, rangeHeader: string | undefined) {
    const totalBytes = Number(file.bytes);
    reply.header("content-type", file.mime_type).header("accept-ranges", "bytes").header("cache-control", "private, max-age=86400, immutable").header("x-content-type-options", "nosniff");
    const safeFilename = file.filename.replace(/[\r\n"]/g, "_"); reply.header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
    if (/(?:html|svg|xml|javascript)/i.test(file.mime_type)) reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
    if (config.USE_X_ACCEL) return reply.header("content-length", totalBytes).header("x-accel-redirect", `${config.INTERNAL_MEDIA_PREFIX}${file.storage_key.replace(/^objects\//, "")}`).send();
    const range = parseRange(rangeHeader, totalBytes);
    if (range === "invalid") return reply.header("content-range", `bytes */${totalBytes}`).status(416).send();
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
}

async function completeUpload(userId: string, uploadId: string) {
  const upload = await transaction(async (client) => {
    const locked = await ownedUpload(userId, uploadId, client, true);
    if (locked.status === "complete") return locked;
    if ((locked.status !== "uploading" && locked.status !== "finalizing") || Number(locked.received_bytes) !== Number(locked.declared_bytes)) throw conflict("Upload is incomplete");
    const info = await stat(tempPath(locked.temp_key)).catch(() => null);
    if (!info || !info.isFile() || info.size !== Number(locked.declared_bytes)) throw conflict("Uploaded bytes do not match the declared size");
    await client.query("UPDATE upload_sessions SET status='finalizing',updated_at=now() WHERE id=$1", [uploadId]);
    return { ...locked, status: "finalizing" };
  });
  if (upload.status === "complete") return { attachment: await attachment(upload.id) };
  const object = await stageObject(upload.temp_key);
  if (object.bytes !== Number(upload.declared_bytes)) throw conflict("Final object size does not match the upload");
  const attachmentId = upload.id;
  const processMedia = canProcessMedia(upload.kind, upload.media_purpose, object.detectedMimeType);
  await transaction(async (client) => {
    const locked = await ownedUpload(userId, uploadId, client, true);
    if (locked.status === "complete") return;
    if (locked.status !== "finalizing") throw conflict("Upload is not ready to finalize");
    const blob = await client.query<{ id: string }>(
      `INSERT INTO blobs(id,checksum_sha256,storage_key,bytes,detected_mime_type) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (checksum_sha256) DO UPDATE SET checksum_sha256=EXCLUDED.checksum_sha256 RETURNING id`,
      [newId(), object.checksum, object.storageKey, object.bytes, object.detectedMimeType]);
    await client.query(
      `INSERT INTO attachments(id,owner_id,blob_id,filename,kind,mime_type,bytes,quality,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`, [attachmentId, userId, blob.rows[0]!.id, upload.filename, upload.kind, object.detectedMimeType, object.bytes, upload.quality, processMedia ? "processing" : "ready"]);
    if (processMedia) {
      await client.query("INSERT INTO media_jobs(id,attachment_id,profile) SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM media_jobs WHERE attachment_id=$2 AND profile=$3)", [newId(), attachmentId, upload.quality]);
    }
    await client.query("UPDATE upload_sessions SET status='complete',checksum_sha256=$2,updated_at=now() WHERE id=$1", [uploadId, object.checksum]);
  });
  await removeTemporary(upload.temp_key);
  return { attachment: await attachment(attachmentId) };
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

async function ownedUpload(userId: string, id: string, client: Pick<import("../../db/pool.js").DbClient, "query"> = pool, forUpdate = false) {
  const result = await client.query<{ id: string; filename: string; declared_bytes: string; received_bytes: string; quality: Attachment["quality"]; kind: Attachment["kind"]; media_purpose: "standard" | "voice" | "video-note"; temp_key: string; status: string }>(`SELECT id,filename,declared_bytes::text,received_bytes::text,quality,kind,media_purpose,temp_key,status FROM upload_sessions WHERE id=$1 AND owner_id=$2 AND expires_at>now()${forUpdate ? " FOR UPDATE" : ""}`, [id, userId]);
  if (!result.rows[0]) throw notFound("Upload session not found"); return result.rows[0];
}

async function attachment(id: string): Promise<Attachment> {
  const row = (await pool.query<{ id: string; owner_id: string; kind: Attachment["kind"]; filename: string; mime_type: string; bytes: string; width: number | null; height: number | null; duration_ms: number | null; quality: Attachment["quality"]; checksum_sha256: string; primary_id: string | null; primary_checksum: string | null; waveform: number[] | null; thumbnail_id: string | null; thumbnail_attachment_id: string | null }>(
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
