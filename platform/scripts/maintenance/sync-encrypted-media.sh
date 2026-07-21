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
SOURCE_ROOT="${SNEZHOK_STORAGE_ROOT:-${MEDIA_ROOT:-$STACK_DIR/data-v3/storage}}"
RECIPIENT_FILE="${SNEZHOK_AGE_RECIPIENT_FILE:-${AGE_RECIPIENT_FILE:-/etc/snezhok/backup-age-recipient.txt}}"
IDENTITY_FILE="${SNEZHOK_AGE_IDENTITY_FILE:-${AGE_IDENTITY_FILE:-/etc/snezhok/backup-age-identity.txt}}"
LOCK_FILE="${SNEZHOK_MAINTENANCE_LOCK:-${MAINTENANCE_LOCK_ROOT:-/var/lib/snezhok-maintenance}/maintenance.lock}"
MIRROR_ROOT="$BACKUP_ROOT/media-objects"

require_absolute_safe_directory "$STACK_DIR" STACK_DIR
require_absolute_safe_directory "$BACKUP_ROOT" BACKUP_ROOT
require_absolute_safe_directory "$SOURCE_ROOT" SOURCE_ROOT
for command in age age-keygen awk df find flock mountpoint realpath sha256sum stat sync tr; do require_command "$command"; done
require_matching_age_identity "$RECIPIENT_FILE" "$IDENTITY_FILE"
mountpoint -q "$BACKUP_ROOT" || { echo "backup root is not a mountpoint" >&2; exit 1; }
test -d "$SOURCE_ROOT/objects"
if find "$SOURCE_ROOT/objects" -type l -print -quit | grep -q .; then die "media object source contains symbolic links"; fi
recipient="$(tr -d '[:space:]' <"$RECIPIENT_FILE")"
LOCK_ROOT=$(dirname "$LOCK_FILE")
require_absolute_safe_directory "$LOCK_ROOT" LOCK_ROOT
mkdir -p "$MIRROR_ROOT" "$LOCK_ROOT"
backup_root_real=$(realpath "$BACKUP_ROOT")
mirror_root_real=$(realpath "$MIRROR_ROOT")
path_is_within "$mirror_root_real" "$backup_root_real" || die "unsafe media mirror destination"
available_bytes=$(df --output=avail -B1 "$BACKUP_ROOT" | tail -n 1 | tr -d ' ')
[[ "$available_bytes" =~ ^[0-9]+$ ]] || die "could not determine backup target free space"
(( available_bytes >= 536870912 )) || die "backup target has less than 512 MiB free"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "another Snezhok maintenance operation is active" >&2; exit 1; }

current_temporary=""
current_checksum_temporary=""
cleanup() {
  result=$?
  [[ -z "$current_temporary" ]] || rm -f -- "$current_temporary"
  [[ -z "$current_checksum_temporary" ]] || rm -f -- "$current_checksum_temporary"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

while IFS= read -r -d '' source; do
  relative="${source#"$SOURCE_ROOT/"}"
  destination="$MIRROR_ROOT/$relative.age"
  checksum="$destination.sha256"
  source_hash=$(sha256sum "$source" | awk '{print $1}')
  if [[ -s "$destination" && -s "$checksum" ]]; then
    stored_source=$(awk 'NR==1 {print $1}' "$checksum")
    stored_cipher=$(awk 'NR==2 {print $1}' "$checksum")
    [[ "$stored_source" == "$source_hash" ]] || die "immutable media source checksum changed: $relative"
    if [[ "$stored_cipher" =~ ^[0-9a-f]{64}$ && "$(sha256sum "$destination" | awk '{print $1}')" == "$stored_cipher" ]]; then
      continue
    fi
    log "repairing corrupted encrypted media mirror object: $relative"
  fi
  mkdir -p "$(dirname "$destination")"
  temporary="$destination.incomplete"
  checksum_temporary="$checksum.incomplete"
  current_temporary=$temporary
  current_checksum_temporary=$checksum_temporary
  rm -f "$temporary" "$checksum_temporary"
  source_bytes=$(stat -c '%s' "$source")
  available_bytes=$(df --output=avail -B1 "$BACKUP_ROOT" | tail -n 1 | tr -d ' ')
  [[ "$source_bytes" =~ ^[0-9]+$ && "$available_bytes" =~ ^[0-9]+$ ]] || die "could not determine per-object mirror capacity"
  (( available_bytes >= source_bytes + 67108864 )) || die "backup target lacks capacity for media object: $relative"
  age --recipient "$recipient" --output "$temporary" "$source"
  chmod 0600 "$temporary"
  cipher_hash=$(sha256sum "$temporary" | awk '{print $1}')
  printf '%s  source\n%s  ciphertext\n' "$source_hash" "$cipher_hash" >"$checksum_temporary"
  chmod 0600 "$checksum_temporary"
  sync -f "$temporary" "$checksum_temporary"
  mv -f "$temporary" "$destination"
  mv -f "$checksum_temporary" "$checksum"
  current_temporary=""
  current_checksum_temporary=""
  sync -f "$destination" "$checksum" "$(dirname "$destination")"
done < <(find "$SOURCE_ROOT/objects" -type f -print0)

# Object keys are immutable. Keep removed source objects encrypted for a grace
# period long enough to cover every retained PITR base and operator mistake.
touch -d '45 days ago' "$MIRROR_ROOT/.retention-cutoff"
while IFS= read -r -d '' archived; do
  relative="${archived#"$MIRROR_ROOT/"}"
  source="$SOURCE_ROOT/${relative%.age}"
  if [[ ! -e "$source" && "$archived" -ot "$MIRROR_ROOT/.retention-cutoff" ]]; then rm -f "$archived" "$archived.sha256"; fi
done < <(find "$MIRROR_ROOT/objects" -type f -name '*.age' -print0 2>/dev/null)
touch "$MIRROR_ROOT/.last-success"
sync -f "$MIRROR_ROOT/.last-success" "$MIRROR_ROOT"
trap - EXIT
