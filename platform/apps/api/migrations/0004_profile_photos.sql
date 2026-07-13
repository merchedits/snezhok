CREATE TABLE user_profile_photos (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0 AND position < 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, attachment_id),
  CONSTRAINT user_profile_photos_position_unique UNIQUE (user_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX user_profile_photos_attachment_idx ON user_profile_photos(attachment_id);

INSERT INTO user_profile_photos(user_id, attachment_id, position)
SELECT id, avatar_attachment_id, 0 FROM users WHERE avatar_attachment_id IS NOT NULL;
