#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source-path=SCRIPTDIR
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

PLATFORM_ROOT=${PLATFORM_ROOT:-$(resolved_platform_root)}
COMPOSE_FILE=${COMPOSE_FILE:-$PLATFORM_ROOT/docker-compose.production.yml}
MEDIA_ROOT=${MEDIA_ROOT:-$PLATFORM_ROOT/data-v3/storage}
OBJECT_GRACE_DAYS=${OBJECT_GRACE_DAYS:-7}
TEMP_GRACE_MINUTES=${TEMP_GRACE_MINUTES:-2880}
apply=false
[[ ${1:-} == "--apply" ]] && apply=true

require_absolute_safe_directory "$MEDIA_ROOT" MEDIA_ROOT
[[ "$OBJECT_GRACE_DAYS" =~ ^[0-9]+$ ]] || die "OBJECT_GRACE_DAYS must be an integer"
[[ "$TEMP_GRACE_MINUTES" =~ ^[0-9]+$ ]] || die "TEMP_GRACE_MINUTES must be an integer"
(( OBJECT_GRACE_DAYS >= 2 )) || die "OBJECT_GRACE_DAYS must be at least 2 to protect in-flight deduplication"
[[ -f "$COMPOSE_FILE" ]] || die "compose file does not exist: $COMPOSE_FILE"
for command in docker find realpath sort grep awk flock mktemp; do require_command "$command"; done
mkdir -p "$MEDIA_ROOT/objects" "$MEDIA_ROOT/tmp"
media_root_real=$(realpath "$MEDIA_ROOT")

lock_root=${MAINTENANCE_LOCK_ROOT:-$PLATFORM_ROOT/.maintenance-locks}
mkdir -p "$lock_root"
exec 9>"$lock_root/maintenance.lock"
flock -n 9 || die "another storage maintenance operation is already running"

services_stopped=false
declare -a running_services=()
restart_services() {
  if ! $services_stopped; then return 0; fi
  local service
  for service in "${running_services[@]}"; do
    log "restoring service $service"
    compose_command "$PLATFORM_ROOT" "$COMPOSE_FILE" up -d --wait --wait-timeout 90 --no-deps "$service"
  done
  services_stopped=false
}
cleanup() {
  local result=$?
  set +e
  restart_services
  rm -rf -- "${temporary_dir:-}"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

if $apply; then
  mapfile -t running_services < <(
    compose_command "$PLATFORM_ROOT" "$COMPOSE_FILE" ps --status running --services \
      | awk '$0 == "app" || $0 == "media-worker"' | sort
  )
  if ((${#running_services[@]})); then
    log "quiescing API and media worker before deleting storage"
    # Compose can stop one service before reporting failure for another. Mark
    # the group first so the EXIT trap always restores the entry state.
    services_stopped=true
    compose_command "$PLATFORM_ROOT" "$COMPOSE_FILE" stop --timeout 30 app media-worker
  fi
fi

temporary_dir=$(mktemp -d)
chmod 0700 "$temporary_dir"
compose_command "$PLATFORM_ROOT" "$COMPOSE_FILE" exec -T postgres psql \
  --username=snezhok --dbname=snezhok --tuples-only --no-align \
  --command='SELECT storage_key FROM blobs ORDER BY storage_key;' \
  | sort -u >"$temporary_dir/referenced-objects"
compose_command "$PLATFORM_ROOT" "$COMPOSE_FILE" exec -T postgres psql \
  --username=snezhok --dbname=snezhok --tuples-only --no-align \
  --command="SELECT temp_key FROM upload_sessions WHERE status IN ('uploading','receiving','finalizing') AND expires_at > now() ORDER BY temp_key;" \
  | sort -u >"$temporary_dir/active-temp-keys"

deleted_objects=0
deleted_temp=0
while IFS= read -r -d '' candidate; do
  candidate_real=$(realpath "$candidate")
  path_is_within "$candidate_real" "$media_root_real/objects" || die "unsafe object path: $candidate_real"
  relative=${candidate_real#"$media_root_real/"}
  filename=$(basename "$candidate_real")
  prefix=$(basename "$(dirname "$candidate_real")")
  # Uploads use a deterministic 24-hex generation suffix while transcoded
  # variants use a UUID suffix. The checksum prefix remains the first 64 hex
  # characters in both immutable formats.
  if [[ ! "$filename" =~ ^([0-9a-f]{64})(-([0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$ ]]; then
    log "skipping unexpected object path $relative"
    continue
  fi
  checksum=${BASH_REMATCH[1]}
  if [[ "$prefix" != "${checksum:0:2}" ]]; then
    log "skipping unexpected object path $relative"
    continue
  fi
  grep -Fqx "$relative" "$temporary_dir/referenced-objects" && continue
  if $apply; then
    rm -f -- "$candidate_real"
    ((deleted_objects += 1))
  else
    printf 'would remove unreferenced object %s\n' "$candidate_real"
  fi
done < <(find "$media_root_real/objects" -mindepth 2 -maxdepth 2 -type f -mtime "+$OBJECT_GRACE_DAYS" -print0)

while IFS= read -r -d '' candidate; do
  candidate_real=$(realpath "$candidate")
  path_is_within "$candidate_real" "$media_root_real/tmp" || die "unsafe temporary upload path: $candidate_real"
  key=$(basename "$candidate_real")
  grep -Fqx "$key" "$temporary_dir/active-temp-keys" && continue
  if $apply; then
    rm -f -- "$candidate_real"
    ((deleted_temp += 1))
  else
    printf 'would remove abandoned temporary upload %s\n' "$candidate_real"
  fi
done < <(find "$media_root_real/tmp" -mindepth 1 -maxdepth 1 -type f -mmin "+$TEMP_GRACE_MINUTES" -print0)

restart_services
log "storage retention complete (objects removed=$deleted_objects, temporary uploads removed=$deleted_temp, apply=$apply)"
