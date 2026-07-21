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
BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/snezhok}
MEDIA_ROOT=${MEDIA_ROOT:-$PLATFORM_ROOT/data-v3/storage}
AGE_RECIPIENT_FILE=${AGE_RECIPIENT_FILE:-}
AGE_IDENTITY_FILE=${AGE_IDENTITY_FILE:-}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}
BACKUP_KEEP_COUNT=${BACKUP_KEEP_COUNT:-14}
BACKUP_REQUIRE_MOUNT=${BACKUP_REQUIRE_MOUNT:-1}

require_absolute_safe_directory "$BACKUP_ROOT" BACKUP_ROOT
require_absolute_safe_directory "$MEDIA_ROOT" MEDIA_ROOT
[[ -f "$COMPOSE_FILE" ]] || die "compose file does not exist: $COMPOSE_FILE"
[[ -n "$AGE_RECIPIENT_FILE" ]] || die "AGE_RECIPIENT_FILE is mandatory; plaintext backups are forbidden"
[[ -n "$AGE_IDENTITY_FILE" ]] || die "AGE_IDENTITY_FILE is mandatory so recovery encryption cannot drift"
for command in age age-keygen awk cp df docker du find flock mktemp mountpoint realpath sha256sum sort stat sync tar tr zstd; do require_command "$command"; done
require_matching_age_identity "$AGE_RECIPIENT_FILE" "$AGE_IDENTITY_FILE"
[[ -d "$MEDIA_ROOT/objects" ]] || die "immutable media object directory does not exist: $MEDIA_ROOT/objects"
if find "$MEDIA_ROOT/objects" -type l -print -quit | grep -q .; then
  die "media object directory contains symbolic links; refusing to archive it"
fi

mkdir -p "$BACKUP_ROOT"
chmod 0700 "$BACKUP_ROOT"
if [[ "$BACKUP_REQUIRE_MOUNT" == "1" ]]; then
  mountpoint --quiet "$BACKUP_ROOT" || die "BACKUP_ROOT is not mounted; refusing to write a false local backup"
elif [[ "$BACKUP_REQUIRE_MOUNT" != "0" ]]; then
  die "BACKUP_REQUIRE_MOUNT must be 0 or 1"
fi
maintenance_lock_root=${MAINTENANCE_LOCK_ROOT:-$PLATFORM_ROOT/.maintenance-locks}
mkdir -p "$maintenance_lock_root"
exec 9>"$maintenance_lock_root/maintenance.lock"
flock -n 9 || die "another Snezhok maintenance operation is already running"

timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
final_dir="$BACKUP_ROOT/snezhok-$timestamp"
[[ ! -e "$final_dir" ]] || die "backup destination already exists: $final_dir"
incomplete_dir=$(mktemp -d "$BACKUP_ROOT/.incomplete-$timestamp-XXXXXX")
chmod 0700 "$incomplete_dir"
snapshot_parent=$(mktemp -d "$PLATFORM_ROOT/data-v3/.backup-snapshot-$timestamp-XXXXXX")
chmod 0700 "$snapshot_parent"

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
  rm -rf -- "$snapshot_parent"
  if (( result != 0 )) && [[ -n "$incomplete_dir" ]]; then rm -rf -- "$incomplete_dir"; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

mapfile -t running_services < <(
  compose_command "$PLATFORM_ROOT" "$COMPOSE_FILE" ps --status running --services \
    | awk '$0 == "app" || $0 == "media-worker"' \
    | sort
)

media_bytes=$(du -sb "$MEDIA_ROOT/objects" | awk '{print $1}')
database_bytes=$(compose_command "$PLATFORM_ROOT" "$COMPOSE_FILE" exec -T postgres \
  psql --username=snezhok --dbname=snezhok --tuples-only --no-align \
  --command="SELECT pg_database_size('snezhok');" | tr -d '[:space:]')
[[ "$database_bytes" =~ ^[0-9]+$ ]] || die "could not determine the PostgreSQL database size"
available_bytes=$(df --output=avail -B1 "$BACKUP_ROOT" | tail -n 1 | tr -d ' ')
[[ "$media_bytes" =~ ^[0-9]+$ && "$available_bytes" =~ ^[0-9]+$ ]] \
  || die "could not determine media size or free backup capacity"
# The custom dump and compressed media should be smaller than their sources,
# but budgeting their full logical sizes plus 512 MiB prevents a full target
# from turning a synchronized maintenance window into an incomplete backup.
minimum_bytes=$((media_bytes + database_bytes + 536870912))
(( available_bytes >= minimum_bytes )) || die "backup target has insufficient free space (need at least $minimum_bytes bytes)"

if ((${#running_services[@]})); then
  log "quiescing API and media worker for a synchronized database/media snapshot"
  # Set this before Compose is invoked: a partial `stop` failure must still
  # make the EXIT trap restore every service that was running on entry.
  services_stopped=true
  compose_command "$PLATFORM_ROOT" "$COMPOSE_FILE" stop --timeout 30 app media-worker
fi

log "streaming an encrypted PostgreSQL custom-format dump"
compose_command "$PLATFORM_ROOT" "$COMPOSE_FILE" exec -T postgres \
  pg_dump --username=snezhok --dbname=snezhok --format=custom --compress=6 --no-owner --no-privileges \
  | age --encrypt --recipients-file "$AGE_RECIPIENT_FILE" --output "$incomplete_dir/database.dump.age"

# Objects are immutable and generation-keyed. A same-filesystem hard-link tree
# captures their directory membership within milliseconds; compression can then
# continue after the app is available again without extending the maintenance
# window or racing a garbage collector.
log "capturing immutable media directory membership"
mkdir -m 0700 "$snapshot_parent/media"
cp -al -- "$MEDIA_ROOT/objects" "$snapshot_parent/media/objects"

restart_services

log "streaming the media snapshot through zstd and age"
tar --numeric-owner --one-file-system -C "$snapshot_parent/media" -cf - objects \
  | zstd --quiet --threads=0 --adapt=min=1,max=5 \
  | age --encrypt --recipients-file "$AGE_RECIPIENT_FILE" --output "$incomplete_dir/media.tar.zst.age"

revision=${SNEZHOK_SOURCE_REVISION:-$(git -C "$PLATFORM_ROOT" rev-parse --verify HEAD 2>/dev/null || true)}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || die "SNEZHOK_SOURCE_REVISION must be the exact deployed public commit"
cat >"$incomplete_dir/manifest.env" <<EOF
SNEZHOK_BACKUP_FORMAT=2
CREATED_AT=$timestamp
SOURCE_REVISION=$revision
DATABASE_FORMAT=postgres-custom
MEDIA_FORMAT=tar-zstd
MEDIA_SCOPE=immutable-objects-only
IN_FLIGHT_UPLOADS=excluded
ENCRYPTION=age
EOF

(
  cd "$incomplete_dir"
  sha256sum database.dump.age media.tar.zst.age manifest.env >SHA256SUMS
  chmod 0400 database.dump.age media.tar.zst.age manifest.env SHA256SUMS
)

# Publication is atomic because the incomplete and final directories share a
# filesystem. The completion marker is written only after encrypted payloads and
# their manifest have reached stable storage.
sync -f "$incomplete_dir/database.dump.age" "$incomplete_dir/media.tar.zst.age" "$incomplete_dir/manifest.env" "$incomplete_dir/SHA256SUMS"
mv -- "$incomplete_dir" "$final_dir"
incomplete_dir=""
touch "$final_dir/.complete"
chmod 0400 "$final_dir/.complete"
sync -f "$final_dir"
log "encrypted backup published atomically: $final_dir"

if [[ -f "$SCRIPT_DIR/prune-backups.sh" ]]; then
  BACKUP_ROOT="$BACKUP_ROOT" BACKUP_RETENTION_DAYS="$BACKUP_RETENTION_DAYS" BACKUP_KEEP_COUNT="$BACKUP_KEEP_COUNT" \
    /usr/bin/env bash "$SCRIPT_DIR/prune-backups.sh" --apply
fi
