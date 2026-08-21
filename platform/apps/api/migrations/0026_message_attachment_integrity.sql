-- Attachment shape is a durable message invariant. Application validation is
-- the first line of defense; deferred database triggers protect migrations,
-- workers and administrative SQL while still allowing atomic message+link and
-- delete+unlink transactions.

CREATE FUNCTION validate_message_attachment_shape(target_message_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  message_kind text;
  message_deleted_at timestamptz;
  attachment_count integer;
  attachment_kinds text[];
BEGIN
  SELECT kind,deleted_at INTO message_kind,message_deleted_at
  FROM messages WHERE id=target_message_id;
  IF NOT FOUND OR message_deleted_at IS NOT NULL THEN RETURN; END IF;

  SELECT count(*)::integer,coalesce(array_agg(a.kind ORDER BY ma.position),'{}'::text[])
    INTO attachment_count,attachment_kinds
  FROM message_attachments ma
  JOIN attachments a ON a.id=ma.attachment_id
  WHERE ma.message_id=target_message_id;

  IF (message_kind IN ('text','system') AND attachment_count <> 0)
    OR (message_kind='voice' AND NOT (attachment_count=1 AND attachment_kinds <@ ARRAY['audio']::text[]))
    OR (message_kind='video-note' AND NOT (attachment_count=1 AND attachment_kinds <@ ARRAY['video']::text[]))
    OR (message_kind='media' AND NOT (attachment_count BETWEEN 1 AND 10 AND attachment_kinds <@ ARRAY['image','video']::text[]))
    OR (message_kind='file' AND NOT (attachment_count BETWEEN 1 AND 10)) THEN
    RAISE EXCEPTION 'Message % has invalid attachment shape for kind %',target_message_id,message_kind
      USING ERRCODE='check_violation',CONSTRAINT='messages_attachment_shape_check';
  END IF;
END
$$;

CREATE FUNCTION enforce_message_attachment_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_id uuid;
BEGIN
  IF TG_TABLE_NAME='message_attachments' THEN
    IF TG_OP='DELETE' THEN target_id := OLD.message_id; ELSE target_id := NEW.message_id; END IF;
  ELSE
    IF TG_OP='DELETE' THEN target_id := OLD.id; ELSE target_id := NEW.id; END IF;
  END IF;
  PERFORM validate_message_attachment_shape(target_id);
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER message_attachment_links_shape
AFTER INSERT OR UPDATE OR DELETE ON message_attachments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_message_attachment_shape();

-- Message creation and its attachment links must share one transaction. The
-- deferred trigger observes the final transaction shape, so imports, workers,
-- and administrative SQL receive the same guarantee as the API service.
CREATE CONSTRAINT TRIGGER messages_existing_attachment_shape
AFTER INSERT OR UPDATE OR DELETE ON messages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_message_attachment_shape();

CREATE VIEW invalid_message_attachment_shapes AS
SELECT m.id,m.kind,count(ma.attachment_id)::integer attachment_count,
  coalesce(array_agg(a.kind ORDER BY ma.position) FILTER (WHERE a.id IS NOT NULL),'{}'::text[]) attachment_kinds
FROM messages m
LEFT JOIN message_attachments ma ON ma.message_id=m.id
LEFT JOIN attachments a ON a.id=ma.attachment_id
WHERE m.deleted_at IS NULL
GROUP BY m.id,m.kind
HAVING (m.kind IN ('text','system') AND count(ma.attachment_id) <> 0)
  OR (m.kind='voice' AND NOT (count(ma.attachment_id)=1 AND coalesce(array_agg(a.kind) FILTER (WHERE a.id IS NOT NULL),'{}'::text[]) <@ ARRAY['audio']::text[]))
  OR (m.kind='video-note' AND NOT (count(ma.attachment_id)=1 AND coalesce(array_agg(a.kind) FILTER (WHERE a.id IS NOT NULL),'{}'::text[]) <@ ARRAY['video']::text[]))
  OR (m.kind='media' AND NOT (count(ma.attachment_id) BETWEEN 1 AND 10 AND coalesce(array_agg(a.kind) FILTER (WHERE a.id IS NOT NULL),'{}'::text[]) <@ ARRAY['image','video']::text[]))
  OR (m.kind='file' AND NOT (count(ma.attachment_id) BETWEEN 1 AND 10));
