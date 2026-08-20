import type { Attachment } from "@snezhok/contracts";
import { uploadMetadataSchema } from "@snezhok/contracts";
import { z } from "zod";

export const initSchema = uploadMetadataSchema.extend({
  filename: z.string().trim().min(1).max(255).optional(), originalName: z.string().trim().min(1).max(255).optional(),
  mimeType: z.string().trim().min(1).max(255), bytes: z.number().int().positive().optional(), totalSize: z.number().int().positive().optional(),
}).refine((value) => Boolean(value.filename ?? value.originalName) && (value.bytes ?? value.totalSize) !== undefined, "Filename and size are required");
export const idParams = z.object({ id: z.string().uuid() });
export const fileQuery = z.object({ variant: z.string().uuid().optional() });
export const completeBody = z.object({ uploadId: z.string().uuid() });
export const waitingUploadSchema = uploadMetadataSchema.extend({
  uploadId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  bytes: z.number().int().positive(),
});
export const waitingGroupSchema = z.object({
  streamId: z.string().uuid(),
  clientId: z.string().uuid(),
  kind: z.enum(["voice", "video-note", "media", "file"]),
  replyToId: z.string().uuid().nullable().default(null),
  silent: z.boolean().default(false),
  uploads: z.array(waitingUploadSchema).min(1).max(10),
  capabilityUploadIds: z.array(z.string().uuid()).max(10).optional(),
});
export const CAPABILITY_HEADER = "upload-capability";

export interface UploadRow {
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

export interface WaitingUploadRow extends UploadRow {
  declared_mime_type: string;
  strip_location: boolean;
  expires_at_ms: number;
}

export type UploadPrincipal =
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
/** @deprecated Migration 0020 owns this policy; retained temporarily as an auditable migration reference. */
export const attachmentAuthorizationLegacySql = `SELECT EXISTS(
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

export const attachmentAuthorizationSql = "SELECT attachment_visible_to_user($1,$2) allowed";

export const fileLookupSql = `SELECT a.owner_id,a.filename,coalesce(v.mime_type,a.mime_type) mime_type,coalesce(vb.storage_key,b.storage_key) storage_key,
         coalesce(v.bytes,a.bytes)::text bytes,coalesce(v.checksum_sha256,b.checksum_sha256) checksum_sha256,v.id variant_id,
         access_check.allowed
       FROM attachments a JOIN blobs b ON b.id=a.blob_id
       CROSS JOIN LATERAL (${attachmentAuthorizationSql}) access_check
       LEFT JOIN media_variants v ON v.attachment_id=a.id AND v.id=$3
       LEFT JOIN blobs vb ON vb.id=v.blob_id WHERE a.id=$1`;
