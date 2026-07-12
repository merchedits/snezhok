-- Durable media processing. The uploaded attachment/blob remains the immutable original.
ALTER TABLE upload_sessions
  ADD COLUMN media_purpose text NOT NULL DEFAULT 'standard'
    CHECK (media_purpose IN ('standard', 'voice', 'video-note'));

ALTER TABLE media_jobs DROP CONSTRAINT media_jobs_status_check;
ALTER TABLE media_jobs
  ADD CONSTRAINT media_jobs_status_check
  CHECK (status IN ('pending', 'running', 'complete', 'failed', 'cancelled'));
ALTER TABLE media_jobs
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 4 CHECK (max_attempts BETWEEN 1 AND 20),
  ADD COLUMN locked_by text,
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN cancel_requested_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
DELETE FROM media_jobs duplicate USING media_jobs keeper
WHERE duplicate.attachment_id=keeper.attachment_id AND duplicate.profile=keeper.profile
  AND (duplicate.created_at,duplicate.id)>(keeper.created_at,keeper.id);
CREATE UNIQUE INDEX media_jobs_attachment_profile_idx ON media_jobs(attachment_id, profile);
CREATE INDEX media_jobs_recovery_idx ON media_jobs(heartbeat_at) WHERE status = 'running';

CREATE TABLE media_variants (
  id uuid PRIMARY KEY,
  attachment_id uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  blob_id uuid NOT NULL REFERENCES blobs(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('primary', 'thumbnail')),
  profile text NOT NULL,
  mime_type text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  checksum_sha256 text NOT NULL CHECK (length(checksum_sha256) = 64),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  waveform jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attachment_id, role, profile)
);
CREATE INDEX media_variants_attachment_idx ON media_variants(attachment_id, role, created_at DESC);
