#!/bin/sh
set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${API_DATABASE_PASSWORD:?API_DATABASE_PASSWORD is required}"
: "${WORKER_DATABASE_PASSWORD:?WORKER_DATABASE_PASSWORD is required}"

export PGPASSWORD="$POSTGRES_PASSWORD"
psql --host=postgres --username=snezhok --dbname=snezhok --set=ON_ERROR_STOP=1 \
  --set=api_password="$API_DATABASE_PASSWORD" --set=worker_password="$WORKER_DATABASE_PASSWORD" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='snezhok_api') THEN CREATE ROLE snezhok_api LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='snezhok_worker') THEN CREATE ROLE snezhok_worker LOGIN; END IF;
END $$;
SELECT format('ALTER ROLE snezhok_api LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', :'api_password') \gexec
SELECT format('ALTER ROLE snezhok_worker LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', :'worker_password') \gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE snezhok TO snezhok_api,snezhok_worker;
GRANT USAGE ON SCHEMA public TO snezhok_api,snezhok_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO snezhok_api;
GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO snezhok_api;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM snezhok_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE media_jobs,attachments,blobs,media_variants TO snezhok_worker;
GRANT SELECT ON TABLE upload_sessions,call_sessions TO snezhok_worker;
GRANT EXECUTE ON FUNCTION publish_attachment_lifecycle(uuid) TO snezhok_api,snezhok_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE snezhok IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO snezhok_api;
ALTER DEFAULT PRIVILEGES FOR ROLE snezhok IN SCHEMA public GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO snezhok_api;
SQL
