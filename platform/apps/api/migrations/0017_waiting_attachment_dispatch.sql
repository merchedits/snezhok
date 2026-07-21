-- Android can finish uploads after the React Native process has been killed.
-- A waiting scheduled message gives those capability-owned workers a
-- server-owned, idempotent dispatch target without persisting account tokens.
ALTER TABLE scheduled_messages DROP CONSTRAINT IF EXISTS scheduled_messages_status_check;
ALTER TABLE scheduled_messages ADD CONSTRAINT scheduled_messages_status_check
  CHECK (status IN ('waiting','pending','delivering','delivered','cancelled','failed'));

ALTER TABLE scheduled_messages
  ADD COLUMN expires_at timestamptz;

ALTER TABLE scheduled_messages ADD CONSTRAINT scheduled_messages_waiting_expiry_check
  CHECK ((status = 'waiting' AND expires_at IS NOT NULL) OR status <> 'waiting');

CREATE INDEX scheduled_messages_waiting_expiry_idx
  ON scheduled_messages(expires_at,id) WHERE status='waiting';
