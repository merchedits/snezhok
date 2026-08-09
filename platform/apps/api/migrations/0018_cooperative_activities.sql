CREATE TABLE cooperative_activities (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  anchor_message_id uuid UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('question','blitz','tiny-quest','color-hunt','song-exchange','movie-list','draw-guess','ideas-jar','memory-capsule','milestone')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','waiting','locked','completed','declined','expired','cancelled')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  private_config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(private_config) = 'object'),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  reveal_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (created_by, client_id)
);
CREATE INDEX cooperative_activities_conversation_idx ON cooperative_activities(conversation_id, created_at DESC);
CREATE INDEX cooperative_activities_reveal_idx ON cooperative_activities(reveal_at, id) WHERE state='locked' AND reveal_at IS NOT NULL;
CREATE UNIQUE INDEX cooperative_activities_living_list_idx ON cooperative_activities(conversation_id,type)
  WHERE type IN ('movie-list','ideas-jar') AND state NOT IN ('cancelled','declined','expired');

CREATE TABLE cooperative_activity_participants (
  activity_id uuid NOT NULL REFERENCES cooperative_activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','submitted','completed','declined')),
  private_state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(private_state) = 'object'),
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);

CREATE TABLE cooperative_activity_entries (
  id uuid PRIMARY KEY,
  activity_id uuid NOT NULL REFERENCES cooperative_activities(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  round integer NOT NULL DEFAULT 0 CHECK (round BETWEEN 0 AND 10000),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cooperative_activity_entries_activity_idx ON cooperative_activity_entries(activity_id, created_at, id);

CREATE TABLE cooperative_activity_attachments (
  entry_id uuid NOT NULL REFERENCES cooperative_activity_entries(id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 99),
  PRIMARY KEY (entry_id, attachment_id),
  UNIQUE (entry_id, position)
);

CREATE TABLE cooperative_activity_commands (
  activity_id uuid NOT NULL REFERENCES cooperative_activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 40),
  resulting_revision bigint NOT NULL CHECK (resulting_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id, client_id)
);

CREATE TABLE cooperative_activity_events (
  id uuid PRIMARY KEY,
  activity_id uuid NOT NULL REFERENCES cooperative_activities(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 40),
  revision bigint NOT NULL CHECK (revision >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cooperative_activity_events_activity_idx ON cooperative_activity_events(activity_id, revision);
