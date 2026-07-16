-- Inheritable server/channel notification controls. NULL means inherit from
-- the next broader layer; a missing row means no override at all.

CREATE TABLE server_notification_settings (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  enabled boolean,
  show_preview boolean,
  sound boolean,
  mobile_enabled boolean,
  mentions_only boolean,
  muted_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,server_id)
);
CREATE INDEX server_notification_settings_user_idx ON server_notification_settings(user_id,updated_at DESC);

ALTER TABLE stream_notification_settings
  ALTER COLUMN enabled DROP NOT NULL,
  ADD COLUMN sound boolean,
  ADD COLUMN mobile_enabled boolean,
  ADD COLUMN mentions_only boolean;
