import { stat } from "node:fs/promises";
import type { FastifyRequest } from "fastify";
import { attachmentSchema, type Attachment } from "@snezhok/contracts";

import { config } from "../../config.js";
import { pool, transaction } from "../../db/pool.js";
import { AppError, conflict, forbidden, notFound, unauthorized } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { getBearerOrCookie } from "../auth/middleware.js";
import { authenticateAccessToken, hashOpaqueToken } from "../auth/service.js";
import { detectTemporaryMimeType, removeObject, removeTemporary, stageObject, tempPath } from "./storage.js";
import { validateDetectedMedia } from "./mediaValidation.js";
import { cancelWaitingDispatchForUploadSql, promoteReadyWaitingDispatchSql, type WaitingUploadDeclaration } from "./waitingDispatch.js";
import { CAPABILITY_HEADER, capabilityUploadSelectSql, type UploadPrincipal, type UploadRow, type WaitingUploadRow } from "./uploadModel.js";

export function assertEmptyFinalizeBody(body: unknown): void {
  if (body === undefined || body === null) return;
  if (Buffer.isBuffer(body) && body.length === 0) return;
  if (typeof body === "string" && body.length === 0) return;
  if (typeof body === "object" && !Array.isArray(body) && Object.keys(body as object).length === 0) return;
  throw conflict("Upload completion body must be empty");
}

export async function completeUpload(principalOrUserId: UploadPrincipal | string, uploadId: string) {
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

export function orderedIdsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function uploadDeclarationMatches(upload: WaitingUploadRow, declaration: WaitingUploadDeclaration): boolean {
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

export function etagMatches(header: string | undefined, etag: string): boolean {
  return Boolean(header?.split(",").some((candidate) => candidate.trim() === etag || candidate.trim() === "*"));
}

export function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function validUploadCapability(value: string | string[] | undefined): string | null {
  const candidate = singleHeader(value)?.trim();
  // 32 random bytes encoded as unpadded base64url. Rejecting all other shapes
  // before hashing keeps malformed secrets out of database work and errors.
  return candidate && /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : null;
}

export async function resolveUploadPrincipal(request: FastifyRequest): Promise<UploadPrincipal> {
  const capability = validUploadCapability(request.headers[CAPABILITY_HEADER]);
  if (capability) return { kind: "capability", capabilityHash: hashOpaqueToken(capability) };
  const token = getBearerOrCookie(request);
  if (!token) throw unauthorized();
  const authenticated = await authenticateAccessToken(token);
  request.auth = authenticated;
  return { kind: "owner", userId: authenticated.id };
}

export async function authorizedUpload(
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

export async function ownedUpload(userId: string, id: string, client: Pick<import("../../db/pool.js").DbClient, "query"> = pool, forUpdate = false) {
  const result = await client.query<UploadRow>(`SELECT id,owner_id,filename,declared_bytes::text,received_bytes::text,quality,kind,media_purpose,temp_key,status FROM upload_sessions WHERE id=$1 AND owner_id=$2 AND expires_at>now()${forUpdate ? " FOR UPDATE" : ""}`, [id, userId]);
  if (!result.rows[0]) throw notFound("Upload session not found"); return result.rows[0];
}

export async function attachment(id: string, client: Pick<import("../../db/pool.js").DbClient, "query"> = pool): Promise<Attachment> {
  const payload = (await client.query<{ payload: unknown }>("SELECT attachment_transport_payload($1) payload", [id])).rows[0]?.payload;
  if (!payload) throw notFound("Attachment not found");
  return attachmentSchema.parse(payload) as Attachment;
}
