#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

platform_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
cd "$platform_root"
compose=(docker compose --file docker-compose.production.yml)

cleanup() {
  result=$?
  set +e
  "${compose[@]}" down --remove-orphans --timeout 10 >/dev/null 2>&1
  docker volume rm snezhok_v3_postgres >/dev/null 2>&1
  exit "$result"
}
trap cleanup EXIT

docker volume create snezhok_v3_postgres >/dev/null
mkdir -p data-v3/storage/objects data-v3/storage/tmp runtime/releases
chmod 0777 data-v3/storage data-v3/storage/objects data-v3/storage/tmp
"${compose[@]}" up --wait --wait-timeout 120 db-provision

owner_query() {
  "${compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -At -U snezhok -d snezhok -c "$1"
}
[[ "$(owner_query "SELECT rolsuper::text||'|'||rolcreatedb::text||'|'||rolcreaterole::text FROM pg_roles WHERE rolname='snezhok_api';")" == "false|false|false" ]]
[[ "$(owner_query "SELECT rolsuper::text||'|'||rolcreatedb::text||'|'||rolcreaterole::text FROM pg_roles WHERE rolname='snezhok_worker';")" == "false|false|false" ]]

api_psql=("${compose[@]}" exec -T -e PGPASSWORD="$API_DATABASE_PASSWORD" postgres psql -v ON_ERROR_STOP=1 -h postgres -U snezhok_api -d snezhok)
worker_psql=("${compose[@]}" exec -T -e PGPASSWORD="$WORKER_DATABASE_PASSWORD" postgres psql -v ON_ERROR_STOP=1 -h postgres -U snezhok_worker -d snezhok)
"${api_psql[@]}" -c 'SELECT count(*) FROM users;' >/dev/null
if "${api_psql[@]}" -c 'CREATE TABLE public.ci_api_must_not_create(id integer);' >/dev/null 2>&1; then
  echo "API role unexpectedly created a schema object" >&2
  exit 1
fi
"${worker_psql[@]}" -c 'SELECT count(*) FROM media_jobs;' >/dev/null
if "${worker_psql[@]}" -c 'SELECT count(*) FROM users;' >/dev/null 2>&1; then
  echo "media-worker role unexpectedly read users" >&2
  exit 1
fi

"${compose[@]}" up -d --wait app media-worker
"${compose[@]}" exec -T app sh -eu -c 'test -z "${POSTGRES_PASSWORD+x}"; test -z "${WORKER_DATABASE_PASSWORD+x}"; test -z "${API_DATABASE_PASSWORD+x}"'
"${compose[@]}" exec -T media-worker sh -eu -c 'test -z "${POSTGRES_PASSWORD+x}"; test -z "${API_DATABASE_PASSWORD+x}"; test -z "${WORKER_DATABASE_PASSWORD+x}"'
echo "production migrations, runtime roles, and credential isolation verified"
