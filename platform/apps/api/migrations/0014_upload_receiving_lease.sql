-- Whole-file uploads claim a durable receiving state before the request body
-- can mutate the temporary object. This prevents concurrent PUT requests from
-- truncating or interleaving the same file.
ALTER TABLE upload_sessions DROP CONSTRAINT IF EXISTS upload_sessions_status_check;
ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_status_check
  CHECK (status IN ('uploading','receiving','finalizing','complete','cancelled','failed'));

DROP INDEX IF EXISTS upload_capability_active_idx;
CREATE UNIQUE INDEX upload_capability_active_idx ON upload_sessions(capability_hash)
  WHERE status IN ('uploading','receiving','finalizing');
