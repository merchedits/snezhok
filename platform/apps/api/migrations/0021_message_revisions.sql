ALTER TABLE messages
  ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE OR REPLACE FUNCTION advance_message_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.revision <= OLD.revision THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_advance_revision
BEFORE UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION advance_message_revision();

CREATE OR REPLACE FUNCTION advance_reacted_message_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_message_id uuid;
BEGIN
  target_message_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.message_id ELSE NEW.message_id END;
  UPDATE messages SET revision = revision + 1 WHERE id = target_message_id;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER message_reactions_advance_revision
AFTER INSERT OR DELETE ON message_reactions
FOR EACH ROW
EXECUTE FUNCTION advance_reacted_message_revision();
