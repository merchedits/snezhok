-- Complete server permission vocabulary and Discord-style channel overrides.

ALTER TABLE server_roles DROP CONSTRAINT server_roles_permissions_check;
ALTER TABLE server_roles ADD CONSTRAINT server_roles_permissions_check CHECK (permissions <@ ARRAY[
  'view_channels','send_messages','attach_files','add_reactions','manage_messages',
  'connect','speak','video','screen_share','move_members','manage_channels',
  'manage_categories','manage_members','kick_members','ban_members','manage_roles',
  'manage_server','view_audit_log'
]::text[]);

CREATE TABLE channel_role_permission_overrides (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES server_roles(id) ON DELETE CASCADE,
  allow_permissions text[] NOT NULL DEFAULT '{}',
  deny_permissions text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(channel_id,role_id),
  CHECK (allow_permissions <@ ARRAY[
    'view_channels','send_messages','attach_files','add_reactions','manage_messages',
    'connect','speak','video','screen_share','move_members','manage_channels',
    'manage_categories','manage_members','kick_members','ban_members','manage_roles',
    'manage_server','view_audit_log'
  ]::text[]),
  CHECK (deny_permissions <@ ARRAY[
    'view_channels','send_messages','attach_files','add_reactions','manage_messages',
    'connect','speak','video','screen_share','move_members','manage_channels',
    'manage_categories','manage_members','kick_members','ban_members','manage_roles',
    'manage_server','view_audit_log'
  ]::text[]),
  CHECK (NOT allow_permissions && deny_permissions)
);

CREATE TABLE channel_everyone_permission_overrides (
  channel_id uuid PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  allow_permissions text[] NOT NULL DEFAULT '{}',
  deny_permissions text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (allow_permissions <@ ARRAY[
    'view_channels','send_messages','attach_files','add_reactions','manage_messages',
    'connect','speak','video','screen_share','move_members','manage_channels',
    'manage_categories','manage_members','kick_members','ban_members','manage_roles',
    'manage_server','view_audit_log'
  ]::text[]),
  CHECK (deny_permissions <@ ARRAY[
    'view_channels','send_messages','attach_files','add_reactions','manage_messages',
    'connect','speak','video','screen_share','move_members','manage_channels',
    'manage_categories','manage_members','kick_members','ban_members','manage_roles',
    'manage_server','view_audit_log'
  ]::text[]),
  CHECK (NOT allow_permissions && deny_permissions)
);

CREATE TABLE channel_member_permission_overrides (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allow_permissions text[] NOT NULL DEFAULT '{}',
  deny_permissions text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(channel_id,user_id),
  CHECK (allow_permissions <@ ARRAY[
    'view_channels','send_messages','attach_files','add_reactions','manage_messages',
    'connect','speak','video','screen_share','move_members','manage_channels',
    'manage_categories','manage_members','kick_members','ban_members','manage_roles',
    'manage_server','view_audit_log'
  ]::text[]),
  CHECK (deny_permissions <@ ARRAY[
    'view_channels','send_messages','attach_files','add_reactions','manage_messages',
    'connect','speak','video','screen_share','move_members','manage_channels',
    'manage_categories','manage_members','kick_members','ban_members','manage_roles',
    'manage_server','view_audit_log'
  ]::text[]),
  CHECK (NOT allow_permissions && deny_permissions)
);

CREATE INDEX channel_role_permission_overrides_role_idx ON channel_role_permission_overrides(role_id,channel_id);
CREATE INDEX channel_member_permission_overrides_user_idx ON channel_member_permission_overrides(user_id,channel_id);
