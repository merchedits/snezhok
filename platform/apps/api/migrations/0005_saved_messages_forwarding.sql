ALTER TABLE conversations
  ADD COLUMN saved_owner_id uuid REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_saved_owner_shape_check
  CHECK (saved_owner_id IS NULL OR (kind = 'direct' AND owner_id = saved_owner_id));

CREATE UNIQUE INDEX conversations_saved_owner_idx
  ON conversations(saved_owner_id) WHERE saved_owner_id IS NOT NULL;

INSERT INTO conversations(id, kind, title, owner_id, saved_owner_id)
SELECT (
  substr(seed.value,1,8) || '-' || substr(seed.value,9,4) || '-5' || substr(seed.value,14,3) ||
  '-a' || substr(seed.value,18,3) || '-' || substr(seed.value,21,12)
)::uuid, 'direct', '', u.id, u.id
FROM users u
CROSS JOIN LATERAL (SELECT md5('snezhok:saved:' || u.id::text) value) seed
WHERE NOT EXISTS (SELECT 1 FROM conversations c WHERE c.saved_owner_id = u.id);

INSERT INTO conversation_members(conversation_id, user_id, role, pinned_at)
SELECT c.id, c.saved_owner_id, 'owner', now()
FROM conversations c
WHERE c.saved_owner_id IS NOT NULL
ON CONFLICT (conversation_id, user_id) DO UPDATE
SET role = 'owner', pinned_at = COALESCE(conversation_members.pinned_at, EXCLUDED.pinned_at), archived_at = NULL;

ALTER TABLE messages
  ADD COLUMN forwarded_from_id uuid REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX messages_forwarded_from_idx ON messages(forwarded_from_id)
  WHERE forwarded_from_id IS NOT NULL;
