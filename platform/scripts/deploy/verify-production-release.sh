#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

REVISION=${1:-${SNEZHOK_SOURCE_REVISION:-}}
PUBLIC_HOST=${SNEZHOK_PUBLIC_HOST:-merchedits.xyz}
LOCAL_HTTPS_ADDRESS=${SNEZHOK_LOCAL_HTTPS_ADDRESS:-127.0.0.1}
API_ORIGIN=${SNEZHOK_API_ORIGIN:-http://127.0.0.1:3003/api/v1}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PLATFORM_ROOT=${PLATFORM_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd -P)}
COMPOSE_FILE=${COMPOSE_FILE:-$PLATFORM_ROOT/docker-compose.production.yml}

[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "exact 40-character source revision required" >&2; exit 1; }
[[ "$PUBLIC_HOST" =~ ^[A-Za-z0-9.-]+$ && "$LOCAL_HTTPS_ADDRESS" =~ ^[0-9A-Fa-f:.]+$ ]] || { echo "invalid verification endpoint" >&2; exit 1; }
for command in curl docker node; do command -v "$command" >/dev/null || { echo "required command missing: $command" >&2; exit 1; }; done

health=$(curl --fail --silent --show-error --max-time 10 "$API_ORIGIN/health")
node -e 'const body=JSON.parse(process.argv[1]); if(body.status!=="ready"||body.revision!==process.argv[2]) process.exit(1)' "$health" "$REVISION"
"$SCRIPT_DIR/verify-production-images.sh" "$REVISION"
"$SCRIPT_DIR/verify-media-storage.sh"

compose=(docker compose --project-directory "$PLATFORM_ROOT" --file "$COMPOSE_FILE")
for service in postgres app job-worker media-worker livekit; do
  container_id=$("${compose[@]}" ps --quiet "$service")
  [[ -n "$container_id" ]] || { echo "$service container is absent" >&2; exit 1; }
  runtime_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
  [[ "$runtime_health" == "healthy" || "$runtime_health" == "running" ]] \
    || { echo "$service container is not healthy: $runtime_health" >&2; exit 1; }
done
app_container=$("${compose[@]}" ps --quiet app)
job_container=$("${compose[@]}" ps --quiet job-worker)
[[ "$(docker inspect --format '{{.Image}}' "$app_container")" == "$(docker inspect --format '{{.Image}}' "$job_container")" ]] \
  || { echo "API and domain job worker do not use the same immutable image" >&2; exit 1; }
job_revision=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$job_container")
[[ "$job_revision" == "$REVISION" ]] || { echo "domain job worker has mismatched source revision" >&2; exit 1; }

tls_health=$(curl --fail --silent --show-error --max-time 10 \
  --resolve "$PUBLIC_HOST:443:$LOCAL_HTTPS_ADDRESS" "https://$PUBLIC_HOST/chat/api/v1/health")
node -e 'const body=JSON.parse(process.argv[1]); if(body.status!=="ready"||body.revision!==process.argv[2]) process.exit(1)' "$tls_health" "$REVISION"

manifest=$(curl --fail --silent --show-error --max-time 10 "$API_ORIGIN/client/android/manifest")
mapfile -t android_release < <(node -e 'const body=JSON.parse(process.argv[1]); if(!Number.isSafeInteger(body.bytes)||body.bytes<1024||!/^\/[A-Za-z0-9_./-]+$/.test(body.downloadUrl)||!/^[0-9a-f]{40}$/.test(body.sourceRevision)) process.exit(1); console.log(body.downloadUrl); console.log(body.sourceRevision)' "$manifest")
[[ ${#android_release[@]} -eq 2 ]] || { echo "Android channel manifest is incomplete" >&2; exit 1; }
download_path=${android_release[0]}
android_source_revision=${android_release[1]}
node "$PLATFORM_ROOT/scripts/compliance/verify-public-source.mjs" \
  --revision "$android_source_revision" --repository https://github.com/merchedits/snezhok
range_result=$(curl --fail --location --silent --show-error --max-time 30 --range 0-1023 -o /dev/null \
  --write-out '%{http_code}|%{size_download}' --resolve "$PUBLIC_HOST:443:$LOCAL_HTTPS_ADDRESS" \
  "https://$PUBLIC_HOST/chat$download_path")
[[ "$range_result" == "206|1024" ]] || { echo "Android channel did not return the required 1024-byte range" >&2; exit 1; }
echo "production release verified locally through TLS for $REVISION"
