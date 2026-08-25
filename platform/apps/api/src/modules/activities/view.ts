import type { Attachment, CooperativeActivity, CooperativeActivityEntry, CooperativeActivityType } from "@snezhok/contracts";
import type { DbClient } from "../../db/pool.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { mapUser, publicUserSelect, type PublicUserRow } from "../users/queries.js";

interface ActivityRow {
  id: string; conversation_id: string; anchor_message_id: string | null; created_by: string;
  type: CooperativeActivityType; state: CooperativeActivity["state"]; revision: string;
  config: Record<string, unknown>; result: Record<string, unknown> | null;
  reveal_at_ms: number | null; completed_at_ms: number | null; created_at_ms: number; updated_at_ms: number;
}

interface ParticipantRow extends PublicUserRow {
  activity_id: string; status: CooperativeActivity["participants"][number]["status"];
  private_state: Record<string, unknown>; submitted_at_ms: number | null; contribution_count: number;
}

interface EntryRow {
  id: string; activity_id: string; created_by: string; kind: string; round: number;
  payload: Record<string, unknown>; attachments: unknown; created_at_ms: number; updated_at_ms: number;
}

export async function getActivityView(client: Pick<DbClient, "query">, activityId: string, viewerId: string) {
  const views = await getActivityViews(client, [activityId], viewerId, "full");
  const view = views.get(activityId);
  if (!view) throw notFound("Activity not found");
  return view;
}

export async function getActivityViews(client: Pick<DbClient, "query">, activityIds: string[], viewerId: string, detail: "summary" | "full" = "summary") {
  const ids = [...new Set(activityIds)];
  const views = new Map<string, CooperativeActivity>();
  if (!ids.length) return views;

  const activities = await client.query<ActivityRow>(
    `SELECT ca.id,ca.conversation_id,ca.anchor_message_id,ca.created_by,ca.type,ca.state,ca.revision::text,
      ca.config,ca.result,
      CASE WHEN ca.reveal_at IS NULL THEN NULL ELSE (extract(epoch from ca.reveal_at)*1000)::bigint::float8 END reveal_at_ms,
      CASE WHEN ca.completed_at IS NULL THEN NULL ELSE (extract(epoch from ca.completed_at)*1000)::bigint::float8 END completed_at_ms,
      (extract(epoch from ca.created_at)*1000)::bigint::float8 created_at_ms,
      (extract(epoch from ca.updated_at)*1000)::bigint::float8 updated_at_ms
     FROM cooperative_activities ca
     WHERE ca.id=ANY($1::uuid[])
       AND EXISTS (SELECT 1 FROM cooperative_activity_participants cap WHERE cap.activity_id=ca.id AND cap.user_id=$2)
       AND EXISTS (
         SELECT 1 FROM messages anchor
         WHERE anchor.id=ca.anchor_message_id AND anchor.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM hidden_messages hidden WHERE hidden.message_id=anchor.id AND hidden.user_id=$2)
       )`,
    [ids, viewerId],
  );
  if (!activities.rows.length) return views;
  const visibleIds = activities.rows.map((row) => row.id);

  const participants = await client.query<ParticipantRow>(
    `SELECT cap.activity_id,cap.status,
      CASE WHEN cap.user_id=$2 OR (activity.type='color-hunt' AND activity.state='completed') THEN cap.private_state ELSE '{}'::jsonb END private_state,
      CASE WHEN cap.submitted_at IS NULL THEN NULL ELSE (extract(epoch from cap.submitted_at)*1000)::bigint::float8 END submitted_at_ms,
      (SELECT count(*)::int FROM cooperative_activity_entries cae WHERE cae.activity_id=cap.activity_id AND cae.created_by=cap.user_id) contribution_count,
      ${publicUserSelect}
     FROM cooperative_activity_participants cap
     JOIN cooperative_activities activity ON activity.id=cap.activity_id
     JOIN users u ON u.id=cap.user_id
     WHERE cap.activity_id=ANY($1::uuid[]) ORDER BY cap.activity_id,u.id`,
    [visibleIds, viewerId],
  );

  const entries = await client.query<EntryRow>(
    `SELECT cae.id,cae.activity_id,cae.created_by,cae.kind,cae.round,cae.payload,
      (extract(epoch from cae.created_at)*1000)::bigint::float8 created_at_ms,
      (extract(epoch from cae.updated_at)*1000)::bigint::float8 updated_at_ms,
      COALESCE(att.items,'[]'::jsonb) attachments
     FROM cooperative_activity_entries cae
     LEFT JOIN LATERAL (
       SELECT jsonb_agg((jsonb_build_object('id',a.id,'ownerId',a.owner_id,'kind',a.kind,'filename',a.filename,
         'mimeType',coalesce(p.mime_type,a.mime_type),'bytes',coalesce(p.bytes,a.bytes),'width',coalesce(p.width,a.width),
         'height',coalesce(p.height,a.height),'durationMs',coalesce(p.duration_ms,a.duration_ms),'quality',a.quality,
         'checksum',b.checksum_sha256,'waveform',p.waveform,
         'originalUrl','/api/v1/files/'||a.id,
         'url',CASE WHEN p.id IS NULL THEN '/api/v1/files/'||a.id ELSE '/api/v1/files/'||a.id||'?variant='||p.id END,
         'thumbnailUrl',CASE WHEN t.id IS NOT NULL THEN '/api/v1/files/'||a.id||'?variant='||t.id WHEN a.thumbnail_attachment_id IS NOT NULL THEN '/api/v1/files/'||a.thumbnail_attachment_id ELSE NULL END,
         'status',a.status,'updatedAt',(extract(epoch from a.updated_at)*1000)::bigint::float8)
         || CASE WHEN p.checksum_sha256 IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('primaryChecksum',p.checksum_sha256) END)
         ORDER BY caa.position) items
       FROM cooperative_activity_attachments caa JOIN attachments a ON a.id=caa.attachment_id JOIN blobs b ON b.id=a.blob_id
       LEFT JOIN LATERAL (SELECT * FROM media_variants WHERE attachment_id=a.id AND role='primary' ORDER BY created_at DESC LIMIT 1) p ON true
       LEFT JOIN LATERAL (SELECT * FROM media_variants WHERE attachment_id=a.id AND role='thumbnail' ORDER BY created_at DESC LIMIT 1) t ON true
       WHERE caa.entry_id=cae.id
     ) att ON true
     WHERE cae.activity_id=ANY($1::uuid[]) ORDER BY cae.created_at,cae.id`,
    [visibleIds],
  );

  for (const row of activities.rows) {
    if (!row.anchor_message_id) continue;
    const activityParticipants = participants.rows.filter((participant) => participant.activity_id === row.id);
    const viewer = activityParticipants.find((participant) => participant.id === viewerId);
    if (!viewer) continue;
    const fullEntries = entries.rows
      .filter((entry) => entry.activity_id === row.id)
      .filter((entry) => entryVisibleToViewer(row, entry.created_by, viewerId))
      .map(mapEntry);
    const activityEntries = detail === "full" || !["movie-list", "ideas-jar", "draw-guess", "memory-capsule"].includes(row.type) ? fullEntries : [];
    const result = row.type === "movie-list" || row.type === "ideas-jar"
      ? { ...(row.result ?? {}), entryCount: fullEntries.length }
      : row.result;
    const concealPeerContributionDetails = participantDetailsArePrivate(row);
    views.set(row.id, {
      id: row.id,
      conversationId: row.conversation_id,
      anchorMessageId: row.anchor_message_id,
      type: row.type,
      state: row.state,
      revision: Number(row.revision),
      createdBy: row.created_by,
      config: row.config,
      privateState: viewer.private_state,
      result: resultVisibleToViewer(row) ? result : null,
      participants: activityParticipants.map((participant) => ({
        user: mapUser(participant), status: participant.status,
        contributionCount: concealPeerContributionDetails && participant.id !== viewerId ? 0 : participant.contribution_count,
        submittedAt: concealPeerContributionDetails && participant.id !== viewerId ? null : participant.submitted_at_ms === null ? null : Number(participant.submitted_at_ms),
        ...(participantPrivateStateIsRevealed(row) ? { revealedState: participant.private_state } : {}),
      })),
      entries: activityEntries,
      createdAt: Number(row.created_at_ms),
      updatedAt: Number(row.updated_at_ms),
      revealAt: row.reveal_at_ms === null ? null : Number(row.reveal_at_ms),
      completedAt: row.completed_at_ms === null ? null : Number(row.completed_at_ms),
      detail,
    });
  }
  return views;
}

export async function requireActivityParticipant(client: Pick<DbClient, "query">, activityId: string, viewerId: string) {
  const result = await client.query("SELECT 1 FROM cooperative_activity_participants WHERE activity_id=$1 AND user_id=$2", [activityId, viewerId]);
  if (!result.rowCount) throw forbidden("You do not have access to this activity");
}

export function entryVisibleToViewer(
  activity: Pick<ActivityRow, "type" | "state" | "config">,
  entryOwnerId: string,
  viewerId: string,
) {
  if (activity.state === "completed") return true;
  if (entryOwnerId === viewerId && activity.type !== "memory-capsule") return true;
  if (activity.type === "memory-capsule") return activity.state === "active" && entryOwnerId === viewerId;
  if (activity.type === "question") return activity.config.secret !== true;
  if (["blitz", "tiny-quest", "color-hunt", "song-exchange"].includes(activity.type)) return false;
  return true;
}

export function participantDetailsArePrivate(activity: Pick<ActivityRow, "type" | "state" | "config">) {
  return activity.state !== "completed" && (
    (activity.type === "question" && activity.config.secret === true)
    || ["blitz", "tiny-quest", "color-hunt", "song-exchange", "memory-capsule"].includes(activity.type)
  );
}

export function participantPrivateStateIsRevealed(activity: Pick<ActivityRow, "type" | "state">) {
  return activity.type === "color-hunt" && activity.state === "completed";
}

function resultVisibleToViewer(activity: Pick<ActivityRow, "type" | "state">) {
  return activity.type !== "memory-capsule" || activity.state === "completed";
}

function mapEntry(row: EntryRow): CooperativeActivityEntry {
  return {
    id: row.id, kind: row.kind, round: row.round, createdBy: row.created_by, payload: row.payload,
    attachments: row.attachments as Attachment[], createdAt: Number(row.created_at_ms), updatedAt: Number(row.updated_at_ms),
  };
}
