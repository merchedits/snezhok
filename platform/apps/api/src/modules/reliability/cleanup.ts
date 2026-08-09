import { rm } from "node:fs/promises";

import { config } from "../../config.js";
import type { DbClient } from "../../db/pool.js";
import { pool, transaction } from "../../db/pool.js";
import { objectPath, removeTemporary, removeUntrackedObjectFiles, removeUntrackedTemporaryFiles } from "../uploads/storage.js";

interface MaintenanceLog {
  info: (fields: object, message: string) => void;
  warn: (fields: object, message: string) => void;
  error: (fields: object, message: string) => void;
}

export interface CleanupOptions {
  eventRetentionDays: number;
  orphanMediaRetentionDays: number;
  pushRetentionDays: number;
  batchSize: number;
  messageRetentionDays?: number | null;
}

export interface CleanupResult {
  prunedUserEvents: number;
  prunedEvents: number;
  expiredCallSessions: number;
  expiredMessages: number;
  expiredUploads: number;
  detachedDeletedMessageFiles: number;
  deletedAttachments: number;
  deletedBlobs: number;
  objectKeys: string[];
  temporaryKeys: string[];
}

const defaults: CleanupOptions = {
  eventRetentionDays: config.EVENT_RETENTION_DAYS,
  orphanMediaRetentionDays: config.ORPHAN_MEDIA_RETENTION_DAYS,
  pushRetentionDays: config.PUSH_DELIVERY_RETENTION_DAYS,
  batchSize: 5_000,
};

export function startReliabilityMaintenance(log: MaintenanceLog): () => void {
  let stopped = false;
  let active = false;
  const run = async () => {
    if (stopped || active) return;
    active = true;
    try {
      const result = await transaction(async (client) => {
        const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock($1) locked", [734_927_302]);
        if (!lock.rows[0]?.locked) return null;
        const settings = (await client.query<{ event_retention_days: number; orphan_media_retention_days: number; message_retention_days: number | null }>(
          "SELECT event_retention_days,orphan_media_retention_days,message_retention_days FROM global_admin_settings WHERE singleton=true",
        )).rows[0];
        return cleanupReliabilityData(client, {
          ...defaults,
          eventRetentionDays: settings?.message_retention_days ? Math.min(settings.event_retention_days, settings.message_retention_days) : settings?.event_retention_days ?? defaults.eventRetentionDays,
          orphanMediaRetentionDays: settings?.orphan_media_retention_days ?? defaults.orphanMediaRetentionDays,
          messageRetentionDays: settings?.message_retention_days ?? null,
        });
      });
      if (!result) return;
      await cleanupPhysicalFiles(result, log);
      const active = await pool.query<{ temp_key: string }>(
        "SELECT temp_key FROM upload_sessions WHERE status IN ('uploading','receiving','finalizing') AND expires_at>now()",
      );
      const untrackedTemporaryFiles = await removeUntrackedTemporaryFiles(
        new Set(active.rows.map((row) => row.temp_key)),
        Date.now() - 48 * 60 * 60 * 1_000,
      );
      const liveObjects = await pool.query<{ storage_key: string }>("SELECT storage_key FROM blobs");
      const untrackedObjectFiles = await removeUntrackedObjectFiles(
        new Set(liveObjects.rows.map((row) => row.storage_key)),
        Date.now() - 48 * 60 * 60 * 1_000,
      );
      log.info({ ...result, objectKeys: result.objectKeys.length, temporaryKeys: result.temporaryKeys.length, untrackedTemporaryFiles, untrackedObjectFiles }, "reliability maintenance completed");
    } catch (error) {
      log.error({ error }, "reliability maintenance failed");
    } finally {
      active = false;
    }
  };
  const timer = setInterval(() => void run(), config.RELIABILITY_CLEANUP_INTERVAL_MINUTES * 60_000);
  timer.unref();
  void run();
  return () => { stopped = true; clearInterval(timer); };
}

export async function cleanupReliabilityData(
  client: Pick<DbClient, "query">,
  options: CleanupOptions = defaults,
): Promise<CleanupResult> {
  const oldUserEvents = await client.query<{ cursor: string; user_id: string }>(
    `SELECT ue.cursor::text,ue.user_id FROM user_events ue JOIN events event ON event.id=ue.event_id
     WHERE event.created_at<now()-($1::text||' days')::interval
     ORDER BY ue.cursor LIMIT $2 FOR UPDATE SKIP LOCKED`,
    [options.eventRetentionDays, options.batchSize],
  );
  const watermarks = new Map<string, number>();
  for (const row of oldUserEvents.rows) watermarks.set(row.user_id, Math.max(watermarks.get(row.user_id) ?? 0, Number(row.cursor)));
  for (const [userId, cursor] of watermarks) {
    await client.query(
      `INSERT INTO event_retention_watermarks(user_id,discarded_through_cursor) VALUES ($1,$2)
       ON CONFLICT(user_id) DO UPDATE SET discarded_through_cursor=GREATEST(event_retention_watermarks.discarded_through_cursor,EXCLUDED.discarded_through_cursor),updated_at=now()`,
      [userId, cursor],
    );
  }
  if (oldUserEvents.rows.length) {
    await client.query("DELETE FROM user_events WHERE cursor=ANY($1::bigint[])", [oldUserEvents.rows.map((row) => row.cursor)]);
  }
  const prunedEvents = await client.query<{ id: string }>(
    `WITH doomed AS (
       SELECT event.id FROM events event
       WHERE event.created_at<now()-($1::text||' days')::interval
         AND NOT EXISTS(SELECT 1 FROM user_events recipient WHERE recipient.event_id=event.id)
       ORDER BY event.created_at,event.id LIMIT $2
     ) DELETE FROM events event USING doomed WHERE event.id=doomed.id RETURNING event.id`,
    [options.eventRetentionDays, options.batchSize],
  );

  const expiredCalls = await client.query<{ id: string }>(
    `WITH doomed AS (
       SELECT call.id FROM call_sessions call
       WHERE call.ended_at<now()-($1::text||' days')::interval
         AND NOT EXISTS (
           SELECT 1 FROM call_media_commands command
           WHERE command.call_session_id=call.id AND command.status IN ('pending','processing','failed')
         )
       ORDER BY call.ended_at,call.id LIMIT $2
     ) DELETE FROM call_sessions call USING doomed WHERE call.id=doomed.id RETURNING call.id`,
    [options.eventRetentionDays, options.batchSize],
  );

  await client.query(
    `UPDATE scheduled_messages scheduled SET status='cancelled',last_error='Attachment upload expired',updated_at=now()
     WHERE scheduled.status='waiting' AND (scheduled.expires_at<=now() OR EXISTS(
       SELECT 1 FROM upload_sessions upload WHERE upload.id=ANY(scheduled.attachment_ids) AND upload.expires_at<=now()
     ))`,
  );
  const expiredUploads = await client.query<{ id: string; temp_key: string }>(
    `WITH doomed AS (
       SELECT id FROM upload_sessions
       WHERE expires_at<now() AND status<>'complete'
       ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
     ) DELETE FROM upload_sessions upload USING doomed WHERE upload.id=doomed.id
       RETURNING upload.id,upload.temp_key`,
    [options.batchSize],
  );
  await client.query(
    `DELETE FROM upload_sessions
     WHERE status='complete' AND updated_at<now()-($1::text||' days')::interval`,
    [options.orphanMediaRetentionDays],
  );

  const expiredMessages = options.messageRetentionDays === null || options.messageRetentionDays === undefined
    ? { rows: [] as Array<{ id: string }> }
    : await client.query<{ id: string }>(
      `WITH doomed AS (
         SELECT id FROM messages WHERE created_at<now()-($1::text||' days')::interval
         ORDER BY created_at,id LIMIT $2
       ) DELETE FROM messages message USING doomed WHERE message.id=doomed.id RETURNING message.id`,
      [options.messageRetentionDays, options.batchSize],
    );

  const detached = await client.query<{ attachment_id: string }>(
    `WITH doomed_messages AS (
       SELECT id FROM messages
       WHERE deleted_at<now()-($1::text||' days')::interval
       ORDER BY deleted_at,id LIMIT $2
     ) DELETE FROM message_attachments link USING doomed_messages
       WHERE link.message_id=doomed_messages.id RETURNING link.attachment_id`,
    [options.orphanMediaRetentionDays, options.batchSize],
  );

  const deletedAttachments = await client.query<{ id: string }>(
    `WITH doomed AS (
       SELECT attachment.id FROM attachments attachment
       WHERE attachment.created_at<now()-($1::text||' days')::interval
         AND NOT EXISTS(SELECT 1 FROM message_attachments link WHERE link.attachment_id=attachment.id)
         AND NOT EXISTS(SELECT 1 FROM user_profile_photos photo WHERE photo.attachment_id=attachment.id)
         AND NOT EXISTS(SELECT 1 FROM users owner WHERE owner.avatar_attachment_id=attachment.id)
         AND NOT EXISTS(SELECT 1 FROM servers server WHERE server.icon_attachment_id=attachment.id)
         AND NOT EXISTS(SELECT 1 FROM conversations conversation WHERE conversation.avatar_attachment_id=attachment.id)
         AND NOT EXISTS(SELECT 1 FROM attachments parent WHERE parent.thumbnail_attachment_id=attachment.id)
         AND NOT EXISTS(SELECT 1 FROM scheduled_messages scheduled WHERE attachment.id=ANY(scheduled.attachment_ids) AND scheduled.status IN ('waiting','pending','delivering'))
         AND NOT EXISTS(SELECT 1 FROM cooperative_activity_attachments activity_link WHERE activity_link.attachment_id=attachment.id)
         AND NOT EXISTS(SELECT 1 FROM media_jobs job WHERE job.attachment_id=attachment.id AND job.status IN ('pending','running'))
       ORDER BY attachment.created_at,attachment.id LIMIT $2
     ) DELETE FROM attachments attachment USING doomed WHERE attachment.id=doomed.id
       RETURNING attachment.id`,
    [options.orphanMediaRetentionDays, options.batchSize],
  );
  // Physical keys are generation-specific even though checksum rows dedupe.
  // A concurrent uploader therefore cannot recreate and adopt the path that
  // this committed row returns for deletion.
  const deletedBlobs = await client.query<{ storage_key: string }>(
    `WITH doomed AS (
       SELECT blob.id FROM blobs blob
       WHERE blob.created_at<now()-($1::text||' days')::interval
         AND NOT EXISTS(SELECT 1 FROM attachments attachment WHERE attachment.blob_id=blob.id)
         AND NOT EXISTS(SELECT 1 FROM media_variants variant WHERE variant.blob_id=blob.id)
       ORDER BY blob.created_at,blob.id LIMIT $2
     ) DELETE FROM blobs blob USING doomed WHERE blob.id=doomed.id
       RETURNING blob.storage_key`,
    [options.orphanMediaRetentionDays, options.batchSize],
  );

  await client.query(
    `DELETE FROM push_delivery_outbox
     WHERE status IN ('delivered','skipped') AND completed_at<now()-($1::text||' days')::interval
        OR status='failed' AND completed_at<now()-interval '30 days'`,
    [options.pushRetentionDays],
  );

  return {
    prunedUserEvents: oldUserEvents.rows.length,
    prunedEvents: prunedEvents.rows.length,
    expiredCallSessions: expiredCalls.rows.length,
    expiredMessages: expiredMessages.rows.length,
    expiredUploads: expiredUploads.rows.length,
    detachedDeletedMessageFiles: detached.rows.length,
    deletedAttachments: deletedAttachments.rows.length,
    deletedBlobs: deletedBlobs.rows.length,
    objectKeys: deletedBlobs.rows.map((row) => row.storage_key),
    temporaryKeys: expiredUploads.rows.map((row) => row.temp_key),
  };
}

async function cleanupPhysicalFiles(result: CleanupResult, log: MaintenanceLog): Promise<void> {
  for (const key of result.temporaryKeys) {
    await removeTemporary(key).catch((error) => log.warn({ key, error }, "expired temporary upload could not be removed"));
  }
  for (const key of result.objectKeys) {
    await rm(objectPath(key), { force: true }).catch((error) => log.warn({ key, error }, "orphaned media object could not be removed"));
  }
}
