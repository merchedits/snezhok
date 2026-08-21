-- Media completion is performed by the deliberately restricted worker role.
-- The lifecycle publisher needs broader read/write access to resolve recipients
-- and append durable events, so execute that narrow operation with the owning
-- migration role instead of granting the worker access to users and events.
ALTER FUNCTION publish_attachment_lifecycle(uuid) SECURITY DEFINER;
ALTER FUNCTION publish_attachment_lifecycle(uuid) SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION publish_attachment_lifecycle(uuid) FROM PUBLIC;
