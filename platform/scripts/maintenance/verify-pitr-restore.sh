#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source-path=SCRIPTDIR
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

PLATFORM_ROOT=${PLATFORM_ROOT:-$(resolved_platform_root)}
BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/snezhok}
AGE_RECIPIENT_FILE=${AGE_RECIPIENT_FILE:-/etc/snezhok/backup-age-recipient.txt}
AGE_IDENTITY_FILE=${AGE_IDENTITY_FILE:-/etc/snezhok/backup-age-identity.txt}
POSTGRES_VERIFY_IMAGE=${POSTGRES_VERIFY_IMAGE:-postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193}
MAINTENANCE_LOCK_ROOT=${MAINTENANCE_LOCK_ROOT:-/var/lib/snezhok-maintenance}

require_absolute_safe_directory "$PLATFORM_ROOT" PLATFORM_ROOT
require_absolute_safe_directory "$BACKUP_ROOT" BACKUP_ROOT
for command in age age-keygen awk date docker find flock grep mktemp mountpoint realpath sed seq sha256sum sleep sort sync tar; do require_command "$command"; done
require_matching_age_identity "$AGE_RECIPIENT_FILE" "$AGE_IDENTITY_FILE"
mountpoint --quiet "$BACKUP_ROOT" || die "BACKUP_ROOT is not mounted"

marker=$(find "$BACKUP_ROOT/pitr-base" -maxdepth 1 -type f -name '*.tar.gz.age.verified' -print | sort | tail -n 1)
[[ -n "$marker" ]] || die "no verified PITR base is available"
base=${marker%.verified}
[[ -f "$base" && ! -L "$base" && ! -L "$marker" ]] || die "PITR base pair is incomplete or unsafe"
expected=$(awk 'NR==1 {print $1}' "$marker")
actual=$(sha256sum "$base" | awk '{print $1}')
[[ "$expected" =~ ^[0-9a-f]{64}$ && "$expected" == "$actual" ]] || die "PITR base checksum mismatch"

mkdir -p "$MAINTENANCE_LOCK_ROOT"
exec 9>"$MAINTENANCE_LOCK_ROOT/maintenance.lock"
flock -n 9 || die "another Snezhok maintenance operation is active"
temporary=$(mktemp -d "$MAINTENANCE_LOCK_ROOT/pitr-verify.XXXXXX")
container="snezhok-pitr-verify-$$"
cleanup() {
  result=$?
  set +e
  docker rm --force "$container" >/dev/null 2>&1
  # The official entrypoint changes PGDATA ownership to its internal postgres
  # UID. Remove plaintext through an isolated root helper, then prove that the
  # host-side directory is empty before reporting success.
  if [[ -n "${temporary:-}" ]]; then
    docker run --rm --network none --entrypoint sh --volume "$temporary:/cleanup" "$POSTGRES_VERIFY_IMAGE" \
      -eu -c 'find /cleanup -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +' >/dev/null 2>&1
    rmdir -- "$temporary" >/dev/null 2>&1
    if [[ -e "$temporary" ]]; then result=1; log "plaintext PITR verification directory could not be removed: $temporary"; fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

mkdir "$temporary/data" "$temporary/wal"
age --decrypt --identity "$AGE_IDENTITY_FILE" "$base" | tar -xzf - -C "$temporary/data"
[[ -s "$temporary/data/PG_VERSION" ]] || die "restored physical base has no PG_VERSION"
rm -f "$temporary/data/postmaster.pid" "$temporary/data/standby.signal"

# Force a deterministic archive boundary and use the returned LSN as the
# recovery target. A successful promotion at this point proves every required
# segment from the selected base is present, authenticated and replayable.
switch_result=$(docker exec snezhok-v3-postgres-1 psql -At -U snezhok -d snezhok -v ON_ERROR_STOP=1 \
  -c "WITH switched AS (SELECT pg_switch_wal() lsn) SELECT lsn::text||'|'||pg_walfile_name(lsn) FROM switched")
target_lsn=${switch_result%%|*}
target_wal=${switch_result#*|}
[[ "$target_lsn" =~ ^[0-9A-F]+/[0-9A-F]+$ && "$target_wal" =~ ^[0-9A-F]{24}$ ]] || die "could not establish a PITR target"
for _ in $(seq 1 90); do
  if docker exec -u postgres snezhok-v3-postgres-1 test -s "/var/lib/postgresql/wal-archive/$target_wal.age"; then break; fi
  sleep 1
done
docker exec -u postgres snezhok-v3-postgres-1 test -s "/var/lib/postgresql/wal-archive/$target_wal.age" \
  || die "target WAL segment was not archived"

mapfile -t wal_names < <(docker exec -u postgres snezhok-v3-postgres-1 sh -c \
  "find /var/lib/postgresql/wal-archive -maxdepth 1 -type f -name '*.age'" \
  | sed 's#.*/##;s/\.age$//' | grep -E '^([0-9A-F]{24}|[0-9A-F]{8}\.history)$' | sort)
((${#wal_names[@]})) || die "no archived WAL is available"
for wal_name in "${wal_names[@]}"; do
  sidecar=$(docker exec -u postgres snezhok-v3-postgres-1 cat "/var/lib/postgresql/wal-archive/$wal_name.age.sha256")
  expected_source=$(awk 'NR==1 {print $1}' <<<"$sidecar")
  expected_cipher=$(awk 'NR==2 {print $1}' <<<"$sidecar")
  cipher="$temporary/wal/$wal_name.age"
  plain="$temporary/wal/$wal_name"
  docker exec -u postgres snezhok-v3-postgres-1 cat "/var/lib/postgresql/wal-archive/$wal_name.age" >"$cipher"
  [[ "$(sha256sum "$cipher" | awk '{print $1}')" == "$expected_cipher" ]] || die "WAL ciphertext checksum mismatch: $wal_name"
  age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$plain" "$cipher"
  rm -f "$cipher"
  [[ "$(sha256sum "$plain" | awk '{print $1}')" == "$expected_source" ]] || die "WAL plaintext checksum mismatch: $wal_name"
done

touch "$temporary/data/recovery.signal"
cat >>"$temporary/data/postgresql.auto.conf" <<EOF
restore_command = 'cp /restore/%f %p'
recovery_target_lsn = '$target_lsn'
recovery_target_action = 'promote'
EOF
docker run --detach --rm --network none --name "$container" \
  --volume "$temporary/data:/var/lib/postgresql/data" --volume "$temporary/wal:/restore:ro" "$POSTGRES_VERIFY_IMAGE" \
  postgres -c listen_addresses='' >/dev/null
for _ in $(seq 1 90); do
  if docker exec "$container" pg_isready --username=snezhok --dbname=snezhok >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready --username=snezhok --dbname=snezhok >/dev/null 2>&1 || die "PITR base did not boot in isolation"
for _ in $(seq 1 90); do
  promoted=$(docker exec "$container" psql -At --username=snezhok --dbname=snezhok --command="SELECT NOT pg_is_in_recovery();" 2>/dev/null || true)
  [[ "$promoted" == "t" ]] && break
  sleep 1
done
[[ "${promoted:-}" == "t" ]] || die "PITR recovery did not reach and promote the requested target"
table_count=$(docker exec "$container" psql -At --username=snezhok --dbname=snezhok --command="SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public';")
invalid_indexes=$(docker exec "$container" psql -At --username=snezhok --dbname=snezhok --command="SELECT count(*) FROM pg_index WHERE NOT indisvalid OR NOT indisready;")
replay_state=$(docker exec "$container" psql -At --username=snezhok --dbname=snezhok \
  --command="SELECT pg_is_in_recovery()::text||'|'||coalesce(pg_last_wal_replay_lsn()::text,'0/0');")
[[ "$replay_state" == false\|* ]] || die "PITR target was not promoted"
(( table_count > 0 && invalid_indexes == 0 )) || die "PITR replay failed database integrity checks"
docker rm --force "$container" >/dev/null

# Erase and prove removal of plaintext before publishing recovery evidence.
docker run --rm --network none --entrypoint sh --volume "$temporary:/cleanup" "$POSTGRES_VERIFY_IMAGE" \
  -eu -c 'find /cleanup -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
rmdir -- "$temporary"
temporary=""

cat >"$marker.restored.tmp" <<EOF
RESTORED_AT=$(date -u +'%Y%m%dT%H%M%SZ')
BASE_SHA256=$actual
RECOVERY_TARGET_LSN=$target_lsn
RECOVERY_TARGET_WAL=$target_wal
AUTHENTICATED_WAL_FILES=${#wal_names[@]}
EOF
chmod 0400 "$marker.restored.tmp"
mv "$marker.restored.tmp" "$marker.restored"
sync -f "$marker.restored" "$(dirname "$marker")"
log "isolated PITR WAL-chain replay and integrity checks passed: $base -> $target_lsn"
