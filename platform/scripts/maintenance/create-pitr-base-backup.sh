#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source-path=SCRIPTDIR
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

STACK_DIR="${SNEZHOK_STACK_DIR:-${PLATFORM_ROOT:-/home/merchedits/sites/snezhok-v3/platform}}"
BACKUP_ROOT="${SNEZHOK_BACKUP_DIR:-${BACKUP_ROOT:-/var/backups/snezhok}}"
IDENTITY_FILE="${SNEZHOK_AGE_IDENTITY_FILE:-${AGE_IDENTITY_FILE:-/etc/snezhok/backup-age-identity.txt}}"
RECIPIENT_FILE="${SNEZHOK_AGE_RECIPIENT_FILE:-${AGE_RECIPIENT_FILE:-/etc/snezhok/backup-age-recipient.txt}}"
LOCK_FILE="${SNEZHOK_MAINTENANCE_LOCK:-${MAINTENANCE_LOCK_ROOT:-/var/lib/snezhok-maintenance}/maintenance.lock}"

require_absolute_safe_directory "$STACK_DIR" STACK_DIR
require_absolute_safe_directory "$BACKUP_ROOT" BACKUP_ROOT
for command in age age-keygen awk date df docker find flock mountpoint realpath sha256sum sort sync tar tr; do require_command "$command"; done
require_matching_age_identity "$RECIPIENT_FILE" "$IDENTITY_FILE"
mountpoint -q "$BACKUP_ROOT" || { echo "backup root is not a mountpoint" >&2; exit 1; }
LOCK_ROOT=$(dirname "$LOCK_FILE")
require_absolute_safe_directory "$LOCK_ROOT" LOCK_ROOT
mkdir -p "$BACKUP_ROOT/pitr-base" "$LOCK_ROOT"
backup_root_real=$(realpath "$BACKUP_ROOT")
pitr_root_real=$(realpath "$BACKUP_ROOT/pitr-base")
path_is_within "$pitr_root_real" "$backup_root_real" || die "unsafe PITR destination"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "another Snezhok maintenance operation is active" >&2; exit 1; }

database_bytes=$(cd "$STACK_DIR" && docker compose --file docker-compose.production.yml exec -T -u postgres postgres \
  psql --username=snezhok --dbname=snezhok --tuples-only --no-align --command="SELECT pg_database_size('snezhok');" | tr -d '[:space:]')
available_bytes=$(df --output=avail -B1 "$BACKUP_ROOT" | tail -n 1 | tr -d ' ')
[[ "$database_bytes" =~ ^[0-9]+$ && "$available_bytes" =~ ^[0-9]+$ ]] || die "could not determine PITR capacity"
(( available_bytes >= database_bytes * 2 + 536870912 )) || die "backup target has insufficient free space for a verified PITR base"

recipient="$(tr -d '[:space:]' <"$RECIPIENT_FILE")"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
incomplete="$BACKUP_ROOT/pitr-base/$timestamp.tar.gz.age.incomplete"
final="$BACKUP_ROOT/pitr-base/$timestamp.tar.gz.age"
verified="$final.verified"
trap 'rm -f "$incomplete"' EXIT

cd "$STACK_DIR"
docker compose --file docker-compose.production.yml exec -T -u postgres postgres \
  pg_basebackup --username snezhok --pgdata=- --format=tar --gzip --wal-method=fetch --checkpoint=fast \
  | age --recipient "$recipient" --output "$incomplete"
test -s "$incomplete"
age --decrypt --identity "$IDENTITY_FILE" "$incomplete" | tar -tzf - | awk '$0 ~ /(^|\/)PG_VERSION$/ { found=1 } END { exit !found }'
mv "$incomplete" "$final"
sha256sum "$final" >"$verified"
sync -f "$final" "$verified" 2>/dev/null || sync

# Five weekly bases plus 45 days of encrypted WAL allow recovery to a recent
# point even if one scheduled base-backup run fails.
find "$BACKUP_ROOT/pitr-base" -maxdepth 1 -type f -name '*.tar.gz.age' -mtime +45 -delete
find "$BACKUP_ROOT/pitr-base" -maxdepth 1 -type f -name '*.tar.gz.age.verified' -mtime +45 -delete
# The WAL directory is intentionally private to the container's postgres UID.
# Retention therefore runs in that security context instead of weakening host
# permissions merely so the maintenance user can traverse it.
cd "$STACK_DIR"
docker compose --file docker-compose.production.yml exec -T -u postgres postgres sh -eu -c \
  "find /var/lib/postgresql/wal-archive -maxdepth 1 -type f \( -name '*.age' -o -name '*.age.sha256' \) -mtime +45 -delete"
trap - EXIT
echo "created and verified encrypted PITR base backup: $final"
