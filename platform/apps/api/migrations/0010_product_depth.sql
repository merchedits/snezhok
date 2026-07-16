-- Account lifecycle, privacy, group/server administration, and mention indexes.
-- The application keeps message authors as anonymized tombstones when an
-- account is deleted so other participants do not lose conversation history.

ALTER TABLE users
  ADD COLUMN deleted_at timestamptz;

CREATE INDEX users_active_username_idx ON users(username) WHERE deleted_at IS NULL;

ALTER TABLE device_sessions
  ADD COLUMN revoked_reason text CHECK (revoked_reason IS NULL OR length(revoked_reason) <= 80);

CREATE TABLE user_privacy_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  direct_messages text NOT NULL DEFAULT 'contacts'
    CHECK (direct_messages IN ('everyone','contacts','nobody')),
  group_invites text NOT NULL DEFAULT 'contacts'
    CHECK (group_invites IN ('everyone','contacts','nobody')),
  profile_photos text NOT NULL DEFAULT 'everyone'
    CHECK (profile_photos IN ('everyone','contacts','nobody')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO user_privacy_settings(user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE server_bans (
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id,user_id)
);
CREATE INDEX server_bans_user_idx ON server_bans(user_id,created_at DESC);

CREATE TABLE server_roles (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  color text,
  position integer NOT NULL DEFAULT 0,
  permissions text[] NOT NULL DEFAULT '{}'
    CHECK (permissions <@ ARRAY[
      'view_channels','send_messages','manage_messages','manage_channels',
      'manage_categories','manage_members','kick_members','ban_members',
      'manage_roles','manage_server','view_audit_log'
    ]::text[]),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id,id)
);
CREATE UNIQUE INDEX server_roles_name_idx ON server_roles(server_id,lower(name));
CREATE INDEX server_roles_position_idx ON server_roles(server_id,position DESC,id);

CREATE TABLE server_member_roles (
  server_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id,user_id,role_id),
  FOREIGN KEY (server_id,user_id) REFERENCES server_members(server_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY (server_id,role_id) REFERENCES server_roles(server_id,id) ON DELETE CASCADE
);
CREATE INDEX server_member_roles_role_idx ON server_member_roles(role_id,user_id);

CREATE TABLE server_audit_log (
  id bigserial PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX server_audit_log_server_idx ON server_audit_log(server_id,id DESC);
CREATE INDEX server_audit_log_actor_idx ON server_audit_log(actor_id,id DESC) WHERE actor_id IS NOT NULL;

CREATE TABLE message_mentions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id,user_id)
);
CREATE INDEX message_mentions_user_idx ON message_mentions(user_id,message_id);
CREATE INDEX message_mentions_message_idx ON message_mentions(message_id,user_id);

CREATE INDEX read_states_manual_unread_idx
  ON read_states(user_id,stream_kind,stream_id)
  WHERE marked_unread_at_sequence IS NOT NULL;
