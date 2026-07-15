CREATE TABLE chat_drafts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stream_kind text NOT NULL CHECK (stream_kind IN ('conversation','channel')),
  stream_id uuid NOT NULL,
  text text NOT NULL DEFAULT '' CHECK (length(text) <= 16000),
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stream_kind, stream_id)
);

CREATE TABLE chat_folders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  position integer NOT NULL DEFAULT 0,
  include_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_folders_user_position_idx ON chat_folders(user_id, position, created_at);

CREATE TABLE chat_folder_streams (
  folder_id uuid NOT NULL REFERENCES chat_folders(id) ON DELETE CASCADE,
  stream_kind text NOT NULL CHECK (stream_kind IN ('conversation','channel')),
  stream_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (folder_id, stream_kind, stream_id)
);

ALTER TABLE messages ADD COLUMN silent boolean NOT NULL DEFAULT false;

CREATE TABLE scheduled_messages (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stream_kind text NOT NULL CHECK (stream_kind IN ('conversation','channel')),
  stream_id uuid NOT NULL,
  client_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text','voice','video-note','media','file')),
  text text NOT NULL DEFAULT '' CHECK (length(text) <= 16000),
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  attachment_ids uuid[] NOT NULL DEFAULT '{}',
  silent boolean NOT NULL DEFAULT false,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivering','delivered','cancelled','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
CREATE INDEX scheduled_messages_due_idx ON scheduled_messages(scheduled_for, id) WHERE status IN ('pending','delivering');
