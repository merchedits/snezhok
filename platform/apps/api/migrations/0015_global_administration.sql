-- Global operator controls. Settings are a singleton with optimistic revisioning;
-- member overrides are intentionally sparse so later default changes still apply.

ALTER TABLE users
  ADD COLUMN suspended_at timestamptz;

CREATE INDEX users_admin_listing_idx
  ON users (is_admin DESC, created_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE TABLE global_admin_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  default_permissions jsonb NOT NULL DEFAULT '{"createServers":true,"createGroups":true,"uploadFiles":true,"startCalls":true}'::jsonb
    CHECK (jsonb_typeof(default_permissions) = 'object'),
  default_storage_quota_bytes bigint NOT NULL DEFAULT 5368709120 CHECK (default_storage_quota_bytes BETWEEN 10485760 AND 1099511627776),
  max_upload_bytes bigint NOT NULL DEFAULT 2147483648 CHECK (max_upload_bytes BETWEEN 1048576 AND 10737418240),
  message_retention_days integer CHECK (message_retention_days BETWEEN 1 AND 3650),
  orphan_media_retention_days integer NOT NULL DEFAULT 30 CHECK (orphan_media_retention_days BETWEEN 1 AND 3650),
  event_retention_days integer NOT NULL DEFAULT 30 CHECK (event_retention_days BETWEEN 1 AND 3650),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (max_upload_bytes <= default_storage_quota_bytes)
);

INSERT INTO global_admin_settings(singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE user_admin_policies (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  permission_overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(permission_overrides) = 'object'),
  storage_quota_bytes bigint CHECK (storage_quota_bytes BETWEEN 10485760 AND 1099511627776),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE global_admin_audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX global_admin_audit_log_history_idx ON global_admin_audit_log(id DESC);
