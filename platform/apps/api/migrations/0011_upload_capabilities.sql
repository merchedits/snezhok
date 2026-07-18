-- A background upload must outlive an Android process without persisting the
-- account's bearer or refresh token.  The client receives one random opaque
-- capability for one upload; only its SHA-256 digest is retained here.

ALTER TABLE upload_sessions
  ADD COLUMN device_session_id uuid REFERENCES device_sessions(id) ON DELETE SET NULL,
  ADD COLUMN capability_hash text CHECK (capability_hash IS NULL OR length(capability_hash) = 64);

CREATE UNIQUE INDEX upload_sessions_capability_hash_idx
  ON upload_sessions(capability_hash)
  WHERE capability_hash IS NOT NULL;

CREATE INDEX upload_sessions_device_session_idx
  ON upload_sessions(device_session_id,expires_at)
  WHERE status IN ('uploading','finalizing');
