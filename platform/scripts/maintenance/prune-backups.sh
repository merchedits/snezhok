#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source-path=SCRIPTDIR
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/snezhok}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}
BACKUP_KEEP_COUNT=${BACKUP_KEEP_COUNT:-14}
apply=false
[[ ${1:-} == "--apply" ]] && apply=true

require_absolute_safe_directory "$BACKUP_ROOT" BACKUP_ROOT
[[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "BACKUP_RETENTION_DAYS must be an integer"
[[ "$BACKUP_KEEP_COUNT" =~ ^[0-9]+$ ]] || die "BACKUP_KEEP_COUNT must be an integer"
(( BACKUP_KEEP_COUNT >= 2 )) || die "BACKUP_KEEP_COUNT must be at least 2"
for command in awk find grep realpath rm sha256sum sort; do require_command "$command"; done
[[ -d "$BACKUP_ROOT" ]] || exit 0

backup_root_real=$(realpath "$BACKUP_ROOT")
# Keep-count applies to restore-proven recovery points. Incomplete and
# unverified directories never consume a protected slot and are never deleted
# automatically; their accumulation is an operator-visible verification alert.
mapfile -t backups < <(
  while IFS= read -r candidate; do
    [[ -f "$candidate/.complete" && ! -L "$candidate/.complete" \
      && -f "$candidate/.verified" && ! -L "$candidate/.verified" ]] && printf '%s\n' "$candidate"
  done < <(find "$backup_root_real" -mindepth 1 -maxdepth 1 -type d -name 'snezhok-*' -print | sort -r)
)
for index in "${!backups[@]}"; do
  candidate=${backups[$index]}
  (( index >= BACKUP_KEEP_COUNT )) || continue
  find "$candidate" -maxdepth 0 -mtime "+$BACKUP_RETENTION_DAYS" -print -quit | grep -q . || continue
  if [[ ! -f "$candidate/SHA256SUMS" || -L "$candidate/SHA256SUMS" ]]; then
    log "retaining backup with a missing or unsafe checksum manifest: $candidate"
    continue
  fi
  expected_checksum=$(awk -F= '$1 == "CHECKSUM_MANIFEST_SHA256" && $2 ~ /^[0-9a-f]{64}$/ { print $2 }' "$candidate/.verified")
  actual_checksum=$(sha256sum "$candidate/SHA256SUMS" | awk '{print $1}')
  [[ -n "$expected_checksum" && "$expected_checksum" == "$actual_checksum" ]] || {
    log "retaining backup whose verification marker no longer matches its checksum manifest: $candidate"
    continue
  }
  candidate_real=$(realpath "$candidate")
  path_is_within "$candidate_real" "$backup_root_real" || die "unsafe backup retention path: $candidate_real"
  if $apply; then
    log "removing verified expired backup $candidate_real"
    rm -rf --one-file-system -- "$candidate_real"
  else
    printf 'would remove %s\n' "$candidate_real"
  fi
done
