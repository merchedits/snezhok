ALTER TABLE call_sessions
  ADD COLUMN first_participant_joined_at timestamptz,
  ADD COLUMN last_participant_left_at timestamptz;

CREATE TABLE call_participant_presence (
  call_session_id uuid NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  first_joined_at timestamptz NOT NULL DEFAULT now(),
  last_joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  join_count integer NOT NULL DEFAULT 1 CHECK (join_count > 0),
  PRIMARY KEY (call_session_id,user_id)
);
CREATE INDEX call_participant_presence_active_idx
  ON call_participant_presence(call_session_id,user_id) WHERE left_at IS NULL;

CREATE TABLE call_media_commands (
  id bigserial PRIMARY KEY,
  call_session_id uuid NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('delete_room','remove_participant')),
  livekit_room text NOT NULL,
  participant_identity text,
  revoke_token_ts bigint,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((action='delete_room' AND participant_identity IS NULL AND revoke_token_ts IS NULL)
      OR (action='remove_participant' AND participant_identity IS NOT NULL AND revoke_token_ts IS NOT NULL))
);
CREATE UNIQUE INDEX call_media_commands_active_unique
  ON call_media_commands(call_session_id,action,coalesce(participant_identity,''))
  WHERE status IN ('pending','processing');
CREATE INDEX call_media_commands_due_idx
  ON call_media_commands(available_at,id) WHERE status='pending';
CREATE INDEX call_media_commands_failed_idx
  ON call_media_commands(updated_at,id) WHERE status='failed';
