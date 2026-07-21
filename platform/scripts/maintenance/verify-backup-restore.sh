#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source-path=SCRIPTDIR
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/snezhok}
AGE_IDENTITY_FILE=${AGE_IDENTITY_FILE:-}
POSTGRES_VERIFY_IMAGE=${POSTGRES_VERIFY_IMAGE:-postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193}
backup_dir=${1:-}

require_absolute_safe_directory "$BACKUP_ROOT" BACKUP_ROOT
[[ -n "$AGE_IDENTITY_FILE" ]] || die "AGE_IDENTITY_FILE is mandatory; restore verification never accepts plaintext backups"
require_private_key_permissions "$AGE_IDENTITY_FILE"
for command in age awk comm cut docker find flock mktemp mountpoint realpath sed sha256sum sort tar zstd; do require_command "$command"; done
mountpoint --quiet "$BACKUP_ROOT" || die "BACKUP_ROOT is not mounted; refusing to verify an accidental local directory"

if [[ -z "$backup_dir" ]]; then
  backup_dir=$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'snezhok-*' -print | sort | tail -n 1)
fi
[[ -n "$backup_dir" ]] || die "no backup was found under $BACKUP_ROOT"
backup_dir=$(realpath "$backup_dir")
backup_root_real=$(realpath "$BACKUP_ROOT")
path_is_within "$backup_dir" "$backup_root_real" || die "backup must be inside BACKUP_ROOT"
[[ -f "$backup_dir/.complete" ]] || die "backup has no atomic completion marker: $backup_dir"
[[ -f "$backup_dir/database.dump.age" && -f "$backup_dir/media.tar.zst.age" ]] || die "encrypted backup payload is incomplete"
[[ ! -e "$backup_dir/database.dump" && ! -e "$backup_dir/media.tar.zst" ]] || die "plaintext backup payload detected; refusing restore"
[[ -f "$backup_dir/manifest.env" && -f "$backup_dir/SHA256SUMS" ]] || die "backup manifest/checksums are missing"
for artifact in .complete database.dump.age media.tar.zst.age manifest.env SHA256SUMS; do
  [[ ! -L "$backup_dir/$artifact" ]] || die "backup artifact must not be a symbolic link: $artifact"
done
grep -qx 'ENCRYPTION=age' "$backup_dir/manifest.env" || die "backup manifest does not declare age encryption"
if ! awk '
  /^[0-9a-f]{64}  (database\.dump\.age|media\.tar\.zst\.age|manifest\.env)$/ { seen[$2]++; valid++ }
  END {
    if (NR != 3 || valid != 3 || seen["database.dump.age"] != 1 || seen["media.tar.zst.age"] != 1 || seen["manifest.env"] != 1) exit 1
  }
' "$backup_dir/SHA256SUMS"; then
  die "checksum manifest must contain exactly the three expected backup artifacts"
fi

mkdir -p "$BACKUP_ROOT"
platform_root=${PLATFORM_ROOT:-$(resolved_platform_root)}
maintenance_lock_root=${MAINTENANCE_LOCK_ROOT:-$platform_root/.maintenance-locks}
mkdir -p "$maintenance_lock_root"
exec 9>"$maintenance_lock_root/maintenance.lock"
flock -n 9 || die "another Snezhok maintenance operation is already running"

log "verifying encrypted artifact hashes"
(cd "$backup_dir" && sha256sum --strict --check SHA256SUMS)

temporary_dir=$(mktemp -d "$BACKUP_ROOT/.restore-verify.XXXXXX")
chmod 0700 "$temporary_dir"
container="snezhok-restore-verify-$(date +%s)-$$"
cleanup() {
  local result=$?
  set +e
  docker rm --force "$container" >/dev/null 2>&1
  rm -rf -- "$temporary_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

log "authenticating the encrypted media archive"
age --decrypt --identity "$AGE_IDENTITY_FILE" "$backup_dir/media.tar.zst.age" | zstd --quiet --test
mkdir "$temporary_dir/media"
age --decrypt --identity "$AGE_IDENTITY_FILE" "$backup_dir/media.tar.zst.age" \
  | tar --zstd --extract --file - --directory "$temporary_dir/media" --no-same-owner --no-same-permissions
find "$temporary_dir/media/objects" -type f -printf '%P\n' | sed 's#^#objects/#' | sort -u >"$temporary_dir/media-files"

log "restoring into an isolated PostgreSQL container"
docker run --detach --rm --network none --name "$container" \
  --env POSTGRES_HOST_AUTH_METHOD=trust "$POSTGRES_VERIFY_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready --username=postgres --dbname=postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready --username=postgres --dbname=postgres >/dev/null 2>&1 \
  || die "temporary PostgreSQL did not become healthy"
docker exec "$container" createdb --username=postgres snezhok_verify
log "authenticating and restoring the encrypted PostgreSQL dump without writing plaintext to disk"
age --decrypt --identity "$AGE_IDENTITY_FILE" "$backup_dir/database.dump.age" \
  | docker exec -i "$container" pg_restore --username=postgres --dbname=snezhok_verify \
      --no-owner --no-privileges --exit-on-error

table_count=$(docker exec "$container" psql --username=postgres --dbname=snezhok_verify --tuples-only --no-align \
  --command="SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public';")
(( table_count > 0 )) || die "restored database has no public tables"
invalid_indexes=$(docker exec "$container" psql --username=postgres --dbname=snezhok_verify --tuples-only --no-align \
  --command="SELECT count(*) FROM pg_index WHERE NOT indisvalid OR NOT indisready;")
(( invalid_indexes == 0 )) || die "restored database contains invalid indexes"
docker exec "$container" psql --username=postgres --dbname=snezhok_verify --tuples-only --no-align \
  --field-separator='|' --command="SELECT storage_key,checksum_sha256 FROM blobs ORDER BY storage_key;" >"$temporary_dir/referenced-media-with-hashes"
cut -d '|' -f 1 "$temporary_dir/referenced-media-with-hashes" >"$temporary_dir/referenced-media"

if ! comm -23 "$temporary_dir/referenced-media" "$temporary_dir/media-files" >"$temporary_dir/missing-media"; then
  die "failed to compare database media references"
fi

while IFS='|' read -r storage_key expected_hash; do
  [[ "$storage_key" == objects/* && "$expected_hash" =~ ^[0-9a-f]{64}$ ]] || die "restored media manifest contains an unsafe row"
  media_path=$(realpath -m -- "$temporary_dir/media/$storage_key")
  path_is_within "$media_path" "$temporary_dir/media/objects" || die "restored media path escaped the verification directory"
  [[ -f "$media_path" && ! -L "$media_path" ]] || die "restored media object is missing or unsafe: $storage_key"
  actual_hash=$(sha256sum "$media_path" | awk '{print $1}')
  [[ "$actual_hash" == "$expected_hash" ]] || die "restored media checksum mismatch: $storage_key"
done <"$temporary_dir/referenced-media-with-hashes"
if [[ -s "$temporary_dir/missing-media" ]]; then
  printf 'missing media objects:\n' >&2
  sed -n '1,20p' "$temporary_dir/missing-media" >&2
  die "media archive does not contain every object referenced by PostgreSQL"
fi

if docker exec "$container" sh -c 'command -v pg_amcheck >/dev/null'; then
  docker exec "$container" psql --username=postgres --dbname=snezhok_verify \
    --command="CREATE EXTENSION IF NOT EXISTS amcheck;" >/dev/null
  docker exec "$container" pg_amcheck --username=postgres --database=snezhok_verify >/dev/null
fi

checksums_hash=$(sha256sum "$backup_dir/SHA256SUMS" | awk '{print $1}')
cat >"$backup_dir/.verified.tmp" <<EOF
VERIFIED_AT=$(date -u +'%Y%m%dT%H%M%SZ')
CHECKSUM_MANIFEST_SHA256=$checksums_hash
POSTGRES_IMAGE=$POSTGRES_VERIFY_IMAGE
EOF
chmod 0400 "$backup_dir/.verified.tmp"
mv -- "$backup_dir/.verified.tmp" "$backup_dir/.verified"
sync -f "$backup_dir/.verified"
log "restore verification passed: $backup_dir"
