ALTER TABLE users ADD COLUMN email text;

ALTER TABLE users ADD CONSTRAINT users_email_format_check CHECK (
  email IS NULL OR (
    email = lower(email)
    AND length(email) BETWEEN 3 AND 254
    AND position('@' IN email) > 1
  )
);

CREATE UNIQUE INDEX users_email_unique_idx ON users(email) WHERE email IS NOT NULL;

DROP TABLE invite_codes;
