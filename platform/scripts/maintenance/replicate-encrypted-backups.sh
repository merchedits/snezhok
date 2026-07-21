#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source-path=SCRIPTDIR
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/snezhok}
RCLONE_CONFIG=${SNEZHOK_RCLONE_CONFIG:-/etc/snezhok/rclone.conf}
OFFSITE_REMOTE=${SNEZHOK_OFFSITE_REMOTE:-}
STATUS_FILE=${SNEZHOK_OFFSITE_STATUS_FILE:-/var/lib/snezhok-maintenance/offsite-replication.status}

require_absolute_safe_directory "$BACKUP_ROOT" BACKUP_ROOT
[[ -n "$OFFSITE_REMOTE" && "$OFFSITE_REMOTE" =~ ^[A-Za-z0-9_-]+:.+[^/]$ ]] \
  || die "SNEZHOK_OFFSITE_REMOTE must name a configured rclone remote and non-root path"
[[ "$OFFSITE_REMOTE" != *$'\n'* && "$OFFSITE_REMOTE" != *$'\r'* ]] || die "off-site remote must be one line"
require_private_key_permissions "$RCLONE_CONFIG"
for command in date dirname mountpoint rclone sync; do require_command "$command"; done
mountpoint --quiet "$BACKUP_ROOT" || die "BACKUP_ROOT is not mounted"

payload_filter_args=(
  --include '/snezhok-*/database.dump.age'
  --include '/snezhok-*/media.tar.zst.age'
  --include '/snezhok-*/manifest.env'
  --include '/snezhok-*/SHA256SUMS'
  --include '/wal/*.age'
  --include '/wal/*.age.sha256'
  --include '/pitr-base/*.tar.gz.age'
  --include '/pitr-base/*.tar.gz.age.verified'
  --include '/media-objects/**/*.age'
  --include '/media-objects/**/*.age.sha256'
  --exclude '**'
)
completion_filter_args=(
  --include '/snezhok-*/.complete'
  --exclude '**'
)
mutable_filter_args=(
  --include '/snezhok-*/.verified'
  --include '/pitr-base/*.tar.gz.age.verified.restored'
  --exclude '**'
)

log "copying encrypted recovery artifacts to the configured off-site target"
rclone --config "$RCLONE_CONFIG" copy "$BACKUP_ROOT" "$OFFSITE_REMOTE" \
  --immutable --checkers 4 --transfers 2 "${payload_filter_args[@]}"
log "checking every encrypted payload before publishing completion markers"
rclone --config "$RCLONE_CONFIG" check "$BACKUP_ROOT" "$OFFSITE_REMOTE" \
  --one-way --checkers 4 "${payload_filter_args[@]}"
rclone --config "$RCLONE_CONFIG" copy "$BACKUP_ROOT" "$OFFSITE_REMOTE" \
  --immutable --checkers 4 --transfers 2 "${completion_filter_args[@]}"
rclone --config "$RCLONE_CONFIG" check "$BACKUP_ROOT" "$OFFSITE_REMOTE" \
  --one-way --checkers 4 "${completion_filter_args[@]}"
log "updating compact restore-verification evidence"
rclone --config "$RCLONE_CONFIG" copy "$BACKUP_ROOT" "$OFFSITE_REMOTE" \
  --checkers 4 --transfers 2 "${mutable_filter_args[@]}"
rclone --config "$RCLONE_CONFIG" check "$BACKUP_ROOT" "$OFFSITE_REMOTE" \
  --one-way --checkers 4 "${mutable_filter_args[@]}"

mkdir -p "$(dirname "$STATUS_FILE")"
status_temporary="$STATUS_FILE.incomplete"
printf 'REPLICATED_AT=%s\n' "$(date -u +'%Y%m%dT%H%M%SZ')" >"$status_temporary"
chmod 0600 "$status_temporary"
sync -f "$status_temporary"
mv -f -- "$status_temporary" "$STATUS_FILE"
sync -f "$STATUS_FILE" "$(dirname "$STATUS_FILE")"
log "off-site encrypted recovery replication and verification passed"
