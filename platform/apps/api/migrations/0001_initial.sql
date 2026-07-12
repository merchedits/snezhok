CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  username text NOT NULL CHECK (username = lower(username) AND length(username) BETWEEN 3 AND 32),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 48),
  avatar_attachment_id uuid,
  avatar_color text NOT NULL DEFAULT '#5b8def',
  bio text NOT NULL DEFAULT '' CHECK (length(bio) <= 512),
  status_text text NOT NULL DEFAULT '' CHECK (length(status_text) <= 128),
  presence_preference text NOT NULL DEFAULT 'online' CHECK (presence_preference IN ('online','idle','do-not-disturb','invisible')),
  is_admin boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username)
);

CREATE TABLE credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  algorithm text NOT NULL CHECK (algorithm IN ('argon2id','bcrypt')),
  password_changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  platform text NOT NULL CHECK (platform IN ('web','android')),
  refresh_token_hash text NOT NULL UNIQUE,
  ip_address inet,
  user_agent text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX device_sessions_user_idx ON device_sessions(user_id, last_used_at DESC);

CREATE TABLE invite_codes (
  id uuid PRIMARY KEY,
  code_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE friendships (
  user_low_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id)
);

CREATE TABLE friend_requests (
  id uuid PRIMARY KEY,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (sender_id <> receiver_id)
);
CREATE UNIQUE INDEX friend_requests_pending_pair_idx
  ON friend_requests (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id))
  WHERE status = 'pending';

CREATE TABLE user_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE servers (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  icon_attachment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE server_members (
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','moderator','member')),
  position integer NOT NULL DEFAULT 0,
  muted_until timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX server_members_user_idx ON server_members(user_id);

CREATE TABLE channel_categories (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX channel_categories_server_idx ON channel_categories(server_id, position);

CREATE TABLE channels (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  category_id uuid REFERENCES channel_categories(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('text','voice')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  topic text NOT NULL DEFAULT '' CHECK (length(topic) <= 1024),
  position integer NOT NULL DEFAULT 0,
  next_message_sequence bigint NOT NULL DEFAULT 1 CHECK (next_message_sequence > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, name)
);
CREATE INDEX channels_server_idx ON channels(server_id, position);

CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('direct','group')),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 80),
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  avatar_attachment_id uuid,
  next_message_sequence bigint NOT NULL DEFAULT 1 CHECK (next_message_sequence > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  muted_until timestamptz,
  pinned_at timestamptz,
  archived_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members(user_id);

CREATE TABLE read_states (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stream_kind text NOT NULL CHECK (stream_kind IN ('conversation','channel')),
  stream_id uuid NOT NULL,
  last_read_sequence bigint NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0),
  marked_unread_at_sequence bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stream_kind, stream_id)
);

CREATE TABLE blobs (
  id uuid PRIMARY KEY,
  checksum_sha256 text NOT NULL UNIQUE CHECK (length(checksum_sha256) = 64),
  storage_key text NOT NULL UNIQUE,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  detected_mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE upload_sessions (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  declared_mime_type text NOT NULL,
  declared_bytes bigint NOT NULL CHECK (declared_bytes >= 0),
  received_bytes bigint NOT NULL DEFAULT 0 CHECK (received_bytes >= 0),
  quality text NOT NULL CHECK (quality IN ('data-saver','auto','high','original')),
  kind text NOT NULL CHECK (kind IN ('image','video','audio','document')),
  strip_location boolean NOT NULL DEFAULT true,
  temp_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','finalizing','complete','cancelled','failed')),
  checksum_sha256 text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (received_bytes <= declared_bytes)
);
CREATE INDEX upload_sessions_owner_idx ON upload_sessions(owner_id, created_at DESC);

CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  blob_id uuid NOT NULL REFERENCES blobs(id) ON DELETE RESTRICT,
  filename text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image','video','audio','document')),
  mime_type text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  width integer,
  height integer,
  duration_ms integer,
  quality text NOT NULL CHECK (quality IN ('data-saver','auto','high','original')),
  thumbnail_attachment_id uuid REFERENCES attachments(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('processing','ready','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD CONSTRAINT users_avatar_fk FOREIGN KEY (avatar_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL;
ALTER TABLE servers ADD CONSTRAINT servers_icon_fk FOREIGN KEY (icon_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD CONSTRAINT conversations_avatar_fk FOREIGN KEY (avatar_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL;

CREATE TABLE media_jobs (
  id uuid PRIMARY KEY,
  attachment_id uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  profile text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','complete','failed')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  available_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_jobs_pending_idx ON media_jobs(available_at) WHERE status = 'pending';

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  stream_kind text NOT NULL CHECK (stream_kind IN ('conversation','channel')),
  stream_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text','system','voice','video-note','media','file')),
  text text NOT NULL DEFAULT '' CHECK (length(text) <= 16000),
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  pinned_at timestamptz,
  pinned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (stream_kind, stream_id, sequence),
  UNIQUE (sender_id, client_id)
);
CREATE INDEX messages_stream_history_idx ON messages(stream_kind, stream_id, sequence DESC);
CREATE INDEX messages_search_idx ON messages USING gin (to_tsvector('simple', text)) WHERE deleted_at IS NULL;

CREATE TABLE message_attachments (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, attachment_id),
  UNIQUE (message_id, position)
);

CREATE TABLE message_reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (length(emoji) BETWEEN 1 AND 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE events (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_events (
  cursor bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  UNIQUE (user_id, event_id)
);
CREATE INDEX user_events_sync_idx ON user_events(user_id, cursor);

CREATE TABLE call_sessions (
  id uuid PRIMARY KEY,
  stream_kind text NOT NULL CHECK (stream_kind IN ('conversation','channel')),
  stream_id uuid NOT NULL,
  livekit_room text NOT NULL UNIQUE,
  started_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE UNIQUE INDEX call_sessions_one_active_stream_idx ON call_sessions(stream_kind,stream_id) WHERE ended_at IS NULL;

CREATE TABLE legacy_import_map (
  entity_kind text NOT NULL,
  legacy_id text NOT NULL,
  new_id uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_kind, legacy_id),
  UNIQUE (entity_kind, new_id)
);
