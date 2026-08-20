import pg from "pg";
import { config } from "./config.js";
import type { MediaJob, OutputVariant } from "./types.js";

const { Pool } = pg;
export const pool = new Pool({
  ...(config.DATABASE_HOST ? {
    host: config.DATABASE_HOST,
    port: config.DATABASE_PORT,
    database: config.DATABASE_NAME,
    user: config.DATABASE_USER,
    password: config.DATABASE_PASSWORD,
  } : { connectionString: config.DATABASE_URL }),
  max: 2,
  application_name: "snezhok-media-worker",
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000,
  query_timeout: 20_000,
  idle_in_transaction_session_timeout: 30_000,
});

export const claimJobSql = `WITH candidate AS (
  SELECT j.id FROM media_jobs j
  WHERE j.status='pending' AND j.available_at<=now() AND j.cancel_requested_at IS NULL
    AND ((j.operation='standard' AND EXISTS (SELECT 1 FROM attachments input WHERE input.id=j.attachment_id AND input.blob_id IS NOT NULL)) OR (j.operation='color-collage' AND NOT EXISTS (
      SELECT 1 FROM unnest(j.source_attachment_ids) AS requested(id)
      LEFT JOIN attachments source ON source.id=requested.id
      WHERE source.id IS NULL OR source.status<>'ready' OR source.blob_id IS NULL
    )))
  ORDER BY j.available_at,j.created_at FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE media_jobs j SET status='running',attempts=j.attempts+1,locked_by=$1,started_at=now(),heartbeat_at=now(),updated_at=now()
FROM candidate c,attachments a LEFT JOIN blobs b ON b.id=a.blob_id
LEFT JOIN upload_sessions us ON us.id=a.id
WHERE j.id=c.id AND a.id=j.attachment_id
RETURNING j.id,j.attachment_id,a.owner_id,j.profile,coalesce(us.media_purpose,'standard') purpose,j.operation,j.source_attachment_ids,a.kind,a.mime_type,b.storage_key,coalesce(b.bytes,0)::bigint::float8 original_bytes,a.filename,j.attempts,j.max_attempts`;

export const activeCallSql = `SELECT 1 FROM call_sessions
  WHERE ended_at IS NULL AND started_at >= now()-($1::text || ' hours')::interval LIMIT 1`;

export async function recoverInterruptedJobs() {
  await pool.query(
    `UPDATE media_jobs SET status='pending',locked_by=NULL,started_at=NULL,heartbeat_at=NULL,available_at=now(),
       error=left(coalesce(error||E'\n','')||'Recovered after worker heartbeat expired',4000),updated_at=now()
     WHERE status='running' AND coalesce(heartbeat_at,started_at,created_at) < now()-($1::int*interval '1 second')`,
    [config.STALE_JOB_SECONDS],
  );
}

export async function claimJob(): Promise<MediaJob | null> {
  const result = await pool.query<{
    id: string; attachment_id: string; owner_id: string; profile: MediaJob["profile"]; purpose: MediaJob["purpose"]; operation: MediaJob["operation"]; source_attachment_ids: string[];
    kind: MediaJob["kind"]; mime_type: string; storage_key: string | null; original_bytes: number; filename: string; attempts: number; max_attempts: number;
  }>(
    claimJobSql,
    [config.WORKER_ID],
  );
  const row = result.rows[0];
  if (!row) return null;
  const sourceStorageKeys = row.operation === "color-collage" ? (await pool.query<{ storage_key: string }>(
    `SELECT blob.storage_key FROM unnest($1::uuid[]) WITH ORDINALITY requested(id,position)
       JOIN attachments attachment ON attachment.id=requested.id
       JOIN blobs blob ON blob.id=attachment.blob_id ORDER BY requested.position`,
    [row.source_attachment_ids],
  )).rows.map((source) => source.storage_key) : [];
  return { id: row.id, attachmentId: row.attachment_id, ownerId: row.owner_id, profile: row.profile, purpose: row.purpose, operation: row.operation, sourceStorageKeys, kind: row.kind, originalMimeType: row.mime_type, originalStorageKey: row.storage_key, originalFilename: row.filename, originalBytes: row.original_bytes, attempts: row.attempts, maxAttempts: row.max_attempts };
}

export async function heartbeat(jobId: string) {
  const result = await pool.query<{ cancel_requested_at: Date | null }>("UPDATE media_jobs SET heartbeat_at=now(),updated_at=now() WHERE id=$1 AND status='running' AND locked_by=$2 RETURNING cancel_requested_at", [jobId, config.WORKER_ID]);
  if (!result.rows[0] || result.rows[0].cancel_requested_at) throw new DOMException("Media job cancelled or lease lost", "AbortError");
}

export async function cancellationRequested(jobId: string) {
  const row = (await pool.query<{ cancelled: boolean }>("SELECT status<>'running' OR locked_by<>$2 OR cancel_requested_at IS NOT NULL cancelled FROM media_jobs WHERE id=$1", [jobId, config.WORKER_ID])).rows[0];
  return !row || row.cancelled;
}

export async function completeJob(job: MediaJob, outputs: Array<OutputVariant & { blobId: string; checksum: string; storageKey: string; bytes: number }>): Promise<string[]> {
  const client = await pool.connect();
  const unusedStorageKeys: string[] = [];
  try {
    await client.query("BEGIN");
    const owned = await client.query("SELECT 1 FROM media_jobs WHERE id=$1 AND status='running' AND locked_by=$2 AND cancel_requested_at IS NULL FOR UPDATE", [job.id, config.WORKER_ID]);
    if (!owned.rowCount) throw new DOMException("Media job lease lost", "AbortError");
    let resolvedPrimary: { id: string; bytes: number; mimeType: string } | null = null;
    for (const output of outputs) {
      const blob = await client.query<{ id: string; storage_key: string }>(
        `INSERT INTO blobs(id,checksum_sha256,storage_key,bytes,detected_mime_type) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT(checksum_sha256) DO UPDATE SET checksum_sha256=excluded.checksum_sha256 RETURNING id,storage_key`,
        [output.blobId, output.checksum, output.storageKey, output.bytes, output.mimeType],
      );
      if (blob.rows[0]!.storage_key !== output.storageKey) unusedStorageKeys.push(output.storageKey);
      if (output.role === "primary") resolvedPrimary = { id: blob.rows[0]!.id, bytes: output.bytes, mimeType: output.mimeType };
      await client.query(
        `INSERT INTO media_variants(id,attachment_id,blob_id,role,profile,mime_type,bytes,checksum_sha256,width,height,duration_ms,waveform)
         VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(attachment_id,role,profile) DO UPDATE SET blob_id=excluded.blob_id,mime_type=excluded.mime_type,bytes=excluded.bytes,
           checksum_sha256=excluded.checksum_sha256,width=excluded.width,height=excluded.height,duration_ms=excluded.duration_ms,waveform=excluded.waveform,created_at=now()`,
        [job.attachmentId, blob.rows[0]!.id, output.role, output.profile, output.mimeType, output.bytes, output.checksum, output.width, output.height, output.durationMs, output.waveform ? JSON.stringify(output.waveform) : null],
      );
    }
    const primary = outputs.find((output) => output.role === "primary");
    const thumbnail = outputs.find((output) => output.role === "thumbnail");
    if (primary) await client.query(
      `UPDATE attachments SET width=$2,height=$3,duration_ms=$4,status='ready',updated_at=now(),
         blob_id=CASE WHEN $5='color-collage' THEN $6 ELSE blob_id END,
         bytes=CASE WHEN $5='color-collage' THEN $7 ELSE bytes END,
         mime_type=CASE WHEN $5='color-collage' THEN $8 ELSE mime_type END WHERE id=$1`,
      [job.attachmentId, primary.width, primary.height, primary.durationMs, job.operation, resolvedPrimary?.id ?? null, resolvedPrimary?.bytes ?? 0, resolvedPrimary?.mimeType ?? primary.mimeType],
    );
    if (thumbnail) await client.query("UPDATE attachments SET thumbnail_attachment_id=NULL,updated_at=now() WHERE id=$1", [job.attachmentId]);
    await client.query("UPDATE media_jobs SET status='complete',completed_at=now(),heartbeat_at=NULL,locked_by=NULL,error=NULL,updated_at=now() WHERE id=$1", [job.id]);
    await client.query("SELECT publish_attachment_lifecycle($1)", [job.attachmentId]);
    await client.query("COMMIT");
    return unusedStorageKeys;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function failJob(job: MediaJob, error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof DOMException && error.name === "AbortError") {
    await pool.query(`UPDATE media_jobs SET status=CASE WHEN cancel_requested_at IS NULL THEN 'pending' ELSE 'cancelled' END,
      attempts=CASE WHEN cancel_requested_at IS NULL THEN greatest(0,attempts-1) ELSE attempts END,available_at=now(),locked_by=NULL,heartbeat_at=NULL,error=$3,updated_at=now()
      WHERE id=$1 AND locked_by=$2`, [job.id, config.WORKER_ID, message.slice(0, 4000)]);
    return;
  }
  const delaySeconds = Math.min(900, 5 * (2 ** Math.max(0, job.attempts - 1)));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ status: string }>(
      `UPDATE media_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,
         available_at=CASE WHEN attempts>=max_attempts THEN available_at ELSE now()+($3::int*interval '1 second') END,
         completed_at=CASE WHEN attempts>=max_attempts THEN now() ELSE NULL END,locked_by=NULL,heartbeat_at=NULL,error=$4,updated_at=now()
       WHERE id=$1 AND locked_by=$2 RETURNING status`, [job.id, config.WORKER_ID, delaySeconds, message.slice(0, 4000)],
    );
    // The immutable source is still valid if optimization fails. Expose that
    // fallback instead of leaving the attachment in an endless processing state.
    if (result.rows[0]?.status === "failed") {
      const transitioned = await client.query("UPDATE attachments SET status=$2,updated_at=now() WHERE id=$1 AND status='processing' RETURNING id", [job.attachmentId, job.operation === "color-collage" ? "failed" : "ready"]);
      if (transitioned.rowCount) await client.query("SELECT publish_attachment_lifecycle($1)", [job.attachmentId]);
    }
    await client.query("COMMIT");
  } catch (transitionError) {
    await client.query("ROLLBACK");
    throw transitionError;
  } finally {
    client.release();
  }
}

export async function callsAreActive() {
  if (!config.PAUSE_DURING_CALLS) return false;
  // A lost LiveKit webhook must not stop every thumbnail and transcode job
  // forever. The API uses the same stale-call window when issuing tokens.
  return Boolean((await pool.query(activeCallSql, [config.CALL_STALE_HOURS])).rowCount);
}
