ALTER TABLE attachments
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- One privacy decision is shared by file delivery and asynchronous attachment
-- lifecycle fanout. Keeping it in PostgreSQL prevents the media worker and API
-- from drifting into different authorization rules.
CREATE FUNCTION attachment_visible_to_user(requested_attachment_id uuid, viewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT EXISTS(
    SELECT 1 FROM attachments requested
    WHERE requested.id=requested_attachment_id AND (
      requested.owner_id=viewer_id
      OR EXISTS (
        SELECT 1 FROM user_profile_photos profile
        JOIN attachments source ON source.id=profile.attachment_id
        JOIN user_privacy_settings privacy ON privacy.user_id=profile.user_id
        WHERE (profile.attachment_id=requested_attachment_id OR source.thumbnail_attachment_id=requested_attachment_id)
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks block
            WHERE (block.blocker_id=viewer_id AND block.blocked_id=profile.user_id)
               OR (block.blocker_id=profile.user_id AND block.blocked_id=viewer_id)
          )
          AND (
            privacy.profile_photos='everyone'
            OR (privacy.profile_photos='contacts' AND EXISTS (
              SELECT 1 FROM friendships friendship
              WHERE friendship.user_low_id=LEAST(viewer_id,profile.user_id)
                AND friendship.user_high_id=GREATEST(viewer_id,profile.user_id)
            ))
          )
      )
      OR EXISTS (
        SELECT 1 FROM conversations conversation
        JOIN conversation_members member ON member.conversation_id=conversation.id AND member.user_id=viewer_id
        WHERE conversation.avatar_attachment_id=requested_attachment_id
      )
      OR EXISTS (
        SELECT 1 FROM servers server
        JOIN server_members member ON member.server_id=server.id AND member.user_id=viewer_id
        WHERE server.icon_attachment_id=requested_attachment_id
          AND NOT EXISTS(SELECT 1 FROM server_bans ban WHERE ban.server_id=server.id AND ban.user_id=viewer_id)
      )
      OR EXISTS (
        SELECT 1 FROM message_attachments link
        JOIN messages message ON message.id=link.message_id
        WHERE link.attachment_id=requested_attachment_id
          AND message.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM hidden_messages hidden
            WHERE hidden.user_id=viewer_id AND hidden.message_id=message.id
          )
          AND (
            (message.stream_kind='conversation' AND EXISTS (
              SELECT 1 FROM conversation_members member
              WHERE member.conversation_id=message.stream_id AND member.user_id=viewer_id
            ))
            OR
            (message.stream_kind='channel' AND EXISTS (
              SELECT 1 FROM channels channel
              JOIN server_members member ON member.server_id=channel.server_id
              WHERE channel.id=message.stream_id AND member.user_id=viewer_id
                AND NOT EXISTS(SELECT 1 FROM server_bans ban WHERE ban.server_id=channel.server_id AND ban.user_id=viewer_id)
                AND (
                  member.role='owner'
                  OR coalesce((
                    SELECT override.allow_permissions @> ARRAY['view_channels']::text[]
                    FROM channel_member_permission_overrides override
                    WHERE override.channel_id=channel.id AND override.user_id=viewer_id
                  ),false)
                  OR (
                    NOT coalesce((
                      SELECT override.deny_permissions @> ARRAY['view_channels']::text[]
                      FROM channel_member_permission_overrides override
                      WHERE override.channel_id=channel.id AND override.user_id=viewer_id
                    ),false)
                    AND (
                      EXISTS (
                        SELECT 1 FROM channel_role_permission_overrides override
                        JOIN server_member_roles assigned ON assigned.role_id=override.role_id
                          AND assigned.server_id=channel.server_id AND assigned.user_id=viewer_id
                        WHERE override.channel_id=channel.id
                          AND override.allow_permissions @> ARRAY['view_channels']::text[]
                      )
                      OR (
                        NOT EXISTS (
                          SELECT 1 FROM channel_role_permission_overrides override
                          JOIN server_member_roles assigned ON assigned.role_id=override.role_id
                            AND assigned.server_id=channel.server_id AND assigned.user_id=viewer_id
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
        JOIN cooperative_activity_participants participant ON participant.activity_id=activity.id AND participant.user_id=viewer_id
        JOIN messages anchor ON anchor.id=activity.anchor_message_id
        WHERE activity_link.attachment_id=requested_attachment_id
          AND anchor.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM hidden_messages hidden WHERE hidden.user_id=viewer_id AND hidden.message_id=anchor.id)
          AND (
            activity.state='completed'
            OR (entry.created_by=viewer_id AND activity.type<>'memory-capsule')
            OR (activity.type='memory-capsule' AND activity.state='active' AND entry.created_by=viewer_id)
            OR (activity.type='question' AND coalesce((activity.config->>'secret')::boolean,false)=false)
            OR activity.type IN ('movie-list','draw-guess','ideas-jar','milestone')
          )
      )
    )
  )
$$;

-- Returns a canonical transport projection. A processing collage can have no
-- source blob yet, so the lifecycle envelope remains valid with a null entity.
CREATE FUNCTION attachment_transport_payload(requested_attachment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT CASE WHEN b.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id',a.id,
    'ownerId',a.owner_id,
    'kind',a.kind,
    'filename',a.filename,
    'mimeType',coalesce(p.mime_type,a.mime_type),
    'bytes',coalesce(p.bytes,a.bytes),
    'width',coalesce(p.width,a.width),
    'height',coalesce(p.height,a.height),
    'durationMs',coalesce(p.duration_ms,a.duration_ms),
    'quality',a.quality,
    'status',a.status,
    'updatedAt',(extract(epoch from a.updated_at)*1000)::bigint::float8,
    'checksum',b.checksum_sha256,
    'waveform',p.waveform,
    'originalUrl','/api/v1/files/'||a.id,
    'url',CASE WHEN p.id IS NULL THEN '/api/v1/files/'||a.id ELSE '/api/v1/files/'||a.id||'?variant='||p.id END,
    'thumbnailUrl',CASE WHEN t.id IS NOT NULL THEN '/api/v1/files/'||a.id||'?variant='||t.id WHEN a.thumbnail_attachment_id IS NOT NULL THEN '/api/v1/files/'||a.thumbnail_attachment_id ELSE NULL END
  ) || CASE WHEN p.checksum_sha256 IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('primaryChecksum',p.checksum_sha256) END END
  FROM attachments a
  LEFT JOIN blobs b ON b.id=a.blob_id
  LEFT JOIN LATERAL (SELECT * FROM media_variants WHERE attachment_id=a.id AND role='primary' ORDER BY created_at DESC LIMIT 1) p ON true
  LEFT JOIN LATERAL (SELECT * FROM media_variants WHERE attachment_id=a.id AND role='thumbnail' ORDER BY created_at DESC LIMIT 1) t ON true
  WHERE a.id=requested_attachment_id
$$;

-- The durable event is inserted in the same transaction as the attachment
-- transition. NOTIFY is delivered only after commit, and reconnecting clients
-- replay the user_events cursor instead of losing the completion.
CREATE FUNCTION publish_attachment_lifecycle(requested_attachment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  lifecycle_event_id uuid := gen_random_uuid();
  lifecycle_payload jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id',a.id,
    'status',a.status,
    'updatedAt',(extract(epoch from a.updated_at)*1000)::bigint::float8,
    'attachment',attachment_transport_payload(a.id)
  ) INTO lifecycle_payload
  FROM attachments a WHERE a.id=requested_attachment_id;

  IF lifecycle_payload IS NULL THEN
    RAISE EXCEPTION 'Attachment % does not exist', requested_attachment_id;
  END IF;

  INSERT INTO events(id,name,payload) VALUES (lifecycle_event_id,'attachment:updated',lifecycle_payload);
  INSERT INTO user_events(user_id,event_id,payload)
    SELECT user_account.id,lifecycle_event_id,lifecycle_payload
    FROM users user_account
    WHERE attachment_visible_to_user(requested_attachment_id,user_account.id)
    ON CONFLICT DO NOTHING;
  PERFORM pg_notify('snezhok_events',lifecycle_event_id::text);
  RETURN lifecycle_event_id;
END
$$;
