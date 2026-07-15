CREATE TABLE push_devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform = 'android'),
  installation_id text NOT NULL,
  app_version text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, installation_id)
);
CREATE INDEX push_devices_user_enabled_idx ON push_devices(user_id) WHERE enabled;

ALTER TABLE call_sessions
  ADD COLUMN answered_at timestamptz,
  ADD COLUMN answered_by uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN declined_by uuid[] NOT NULL DEFAULT '{}';
