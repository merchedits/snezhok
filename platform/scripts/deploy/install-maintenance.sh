#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PLATFORM_ROOT=${PLATFORM_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd -P)}
DEPLOY_USER=${SNEZHOK_DEPLOY_USER:-merchedits}
BACKUP_ROOT=${SNEZHOK_BACKUP_ROOT:-/var/backups/snezhok}
MEDIA_ROOT=${SNEZHOK_MEDIA_ROOT:-$PLATFORM_ROOT/data-v3/storage}
SOURCE_REVISION=${SNEZHOK_SOURCE_REVISION:-${1:-}}
ALERT_WEBHOOK_URL=${SNEZHOK_ALERT_WEBHOOK_URL:-}
OFFSITE_REMOTE=${SNEZHOK_OFFSITE_REMOTE:-}
REQUIRE_OFFSITE_BACKUP=${SNEZHOK_REQUIRE_OFFSITE_BACKUP:-0}
ENABLE_TIMERS=false
[[ ${2:-} == "--enable" ]] && ENABLE_TIMERS=true

[[ $EUID -eq 0 ]] || { echo "install-maintenance.sh must run as root" >&2; exit 1; }
[[ "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "SNEZHOK_SOURCE_REVISION must be the exact 40-character public commit" >&2; exit 1; }
[[ "$PLATFORM_ROOT" == /* && "$PLATFORM_ROOT" != "/" ]] || { echo "PLATFORM_ROOT must be an absolute non-root path" >&2; exit 1; }
[[ "$BACKUP_ROOT" == /* && "$BACKUP_ROOT" != "/" ]] || { echo "BACKUP_ROOT must be an absolute non-root path" >&2; exit 1; }
[[ "$MEDIA_ROOT" == /* && "$MEDIA_ROOT" != "/" ]] || { echo "MEDIA_ROOT must be an absolute non-root path" >&2; exit 1; }
[[ "$DEPLOY_USER" == "merchedits" ]] || { echo "systemd units require SNEZHOK_DEPLOY_USER=merchedits" >&2; exit 1; }
[[ "$PLATFORM_ROOT" == "/home/merchedits/sites/snezhok-v3/platform" ]] \
  || { echo "systemd units require the canonical production PLATFORM_ROOT" >&2; exit 1; }
[[ "$BACKUP_ROOT" == "/var/backups/snezhok" ]] \
  || { echo "systemd units require BACKUP_ROOT=/var/backups/snezhok" >&2; exit 1; }
[[ "$MEDIA_ROOT" == "$PLATFORM_ROOT/data-v3/storage" ]] \
  || { echo "systemd units require MEDIA_ROOT below the production platform root" >&2; exit 1; }
[[ -f "$PLATFORM_ROOT/docker-compose.production.yml" ]] || { echo "production Compose file is missing" >&2; exit 1; }
id "$DEPLOY_USER" >/dev/null 2>&1 || { echo "deployment user does not exist: $DEPLOY_USER" >&2; exit 1; }

for value in "$PLATFORM_ROOT" "$BACKUP_ROOT" "$MEDIA_ROOT"; do
  [[ "$(realpath -m -- "$value")" == "$value" ]] || { echo "maintenance paths must be canonical: $value" >&2; exit 1; }
done
if [[ "$ALERT_WEBHOOK_URL" == *$'\n'* || "$ALERT_WEBHOOK_URL" == *$'\r'* ]]; then
  echo "alert webhook must be a single line" >&2
  exit 1
fi
if [[ "$OFFSITE_REMOTE" == *$'\n'* || "$OFFSITE_REMOTE" == *$'\r'* ]]; then
  echo "off-site remote must be a single line" >&2
  exit 1
fi
[[ "$REQUIRE_OFFSITE_BACKUP" == "0" || "$REQUIRE_OFFSITE_BACKUP" == "1" ]] \
  || { echo "SNEZHOK_REQUIRE_OFFSITE_BACKUP must be 0 or 1" >&2; exit 1; }
if [[ "$REQUIRE_OFFSITE_BACKUP" == "1" && -z "$OFFSITE_REMOTE" ]]; then
  echo "required off-site backup needs SNEZHOK_OFFSITE_REMOTE" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends age coreutils curl openssl python3 rclone zstd >/dev/null
for command in docker node rclone systemctl systemd-analyze; do
  command -v "$command" >/dev/null 2>&1 || { echo "required command is not installed: $command" >&2; exit 1; }
done
docker compose version >/dev/null
mountpoint -q "$BACKUP_ROOT" || { echo "backup root is not mounted: $BACKUP_ROOT" >&2; exit 1; }
node "$PLATFORM_ROOT/scripts/compliance/verify-public-source.mjs" \
  --revision "$SOURCE_REVISION" --repository https://github.com/merchedits/snezhok
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 \
  "$PLATFORM_ROOT/data-v3/storage" "$PLATFORM_ROOT/runtime/releases"

install -d -o root -g root -m 0755 /etc/snezhok
environment_tmp=$(mktemp /etc/snezhok/.maintenance.env.XXXXXX)
cleanup() { [[ -z "$environment_tmp" ]] || rm -f -- "$environment_tmp"; }
trap cleanup EXIT

escape_environment_value() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '"%s"' "$value"
}

environment_target=/etc/snezhok/maintenance.env
if [[ -e "$environment_target" ]]; then
  [[ -f "$environment_target" && ! -L "$environment_target" ]] || { echo "maintenance environment is not a safe regular file" >&2; exit 1; }
  existing_mode=$(stat -c '%a' "$environment_target")
  (( (8#$existing_mode & 077) == 0 )) || { echo "maintenance environment must not be group/world accessible" >&2; exit 1; }
  [[ "$(grep -c '^SNEZHOK_SOURCE_REVISION=' "$environment_target")" == "1" ]] || { echo "maintenance environment must contain exactly one source revision" >&2; exit 1; }
  cp --preserve=mode,ownership -- "$environment_target" "$environment_tmp"
  sed -i "s/^SNEZHOK_SOURCE_REVISION=.*/SNEZHOK_SOURCE_REVISION=$SOURCE_REVISION/" "$environment_tmp"
else
  cat >"$environment_tmp" <<EOF
PLATFORM_ROOT=$(escape_environment_value "$PLATFORM_ROOT")
COMPOSE_FILE=$(escape_environment_value "$PLATFORM_ROOT/docker-compose.production.yml")
MEDIA_ROOT=$(escape_environment_value "$MEDIA_ROOT")
BACKUP_ROOT=$(escape_environment_value "$BACKUP_ROOT")
BACKUP_REQUIRE_MOUNT=1
AGE_RECIPIENT_FILE=/etc/snezhok/backup-age-recipient.txt
AGE_IDENTITY_FILE=/etc/snezhok/backup-age-identity.txt
SNEZHOK_SOURCE_REVISION=$SOURCE_REVISION
BACKUP_RETENTION_DAYS=30
BACKUP_KEEP_COUNT=14
UNVERIFIED_BACKUP_RETENTION_DAYS=35
INCOMPLETE_BACKUP_RETENTION_DAYS=7
MEDIA_MIRROR_DELETE_GRACE_DAYS=52
OBJECT_GRACE_DAYS=7
TEMP_GRACE_MINUTES=2880
RELEASE_RETENTION_DAYS=30
RELEASE_KEEP_COUNT=5
SNEZHOK_ALERT_WEBHOOK_URL=$(escape_environment_value "$ALERT_WEBHOOK_URL")
SNEZHOK_MAX_BACKUP_AGE_HOURS=30
SNEZHOK_MAX_VERIFIED_BACKUP_AGE_HOURS=192
SNEZHOK_MAX_DISK_PERCENT=85
SNEZHOK_MAX_UNVERIFIED_BACKUP_AGE_HOURS=960
SNEZHOK_MAX_INCOMPLETE_BACKUP_AGE_HOURS=48
SNEZHOK_LOCAL_TLS_HOST=merchedits.xyz
SNEZHOK_LOCAL_TLS_ADDRESS=127.0.0.1
SNEZHOK_RUN_EXTERNAL_CONNECTIVITY_CHECK=0
SNEZHOK_RCLONE_CONFIG=/etc/snezhok/rclone.conf
SNEZHOK_OFFSITE_REMOTE=$(escape_environment_value "$OFFSITE_REMOTE")
SNEZHOK_REQUIRE_OFFSITE_BACKUP=$REQUIRE_OFFSITE_BACKUP
SNEZHOK_MAX_OFFSITE_BACKUP_AGE_HOURS=36
SNEZHOK_OFFSITE_STATUS_FILE=/var/lib/snezhok-maintenance/offsite-replication.status
EOF
fi

ensure_environment_default() {
  local key=$1
  local value=$2
  local count
  count=$(grep -c "^${key}=" "$environment_tmp" || true)
  [[ "$count" == "0" || "$count" == "1" ]] || { echo "maintenance environment contains duplicate $key" >&2; exit 1; }
  [[ "$count" == "1" ]] || printf '%s=%s\n' "$key" "$value" >>"$environment_tmp"
}
ensure_environment_default UNVERIFIED_BACKUP_RETENTION_DAYS 35
ensure_environment_default INCOMPLETE_BACKUP_RETENTION_DAYS 7
ensure_environment_default MEDIA_MIRROR_DELETE_GRACE_DAYS 52
ensure_environment_default SNEZHOK_MAX_UNVERIFIED_BACKUP_AGE_HOURS 960
ensure_environment_default SNEZHOK_MAX_INCOMPLETE_BACKUP_AGE_HOURS 48
ensure_environment_default SNEZHOK_LOCAL_TLS_HOST merchedits.xyz
ensure_environment_default SNEZHOK_LOCAL_TLS_ADDRESS 127.0.0.1
ensure_environment_default SNEZHOK_RUN_EXTERNAL_CONNECTIVITY_CHECK 0
ensure_environment_default SNEZHOK_RCLONE_CONFIG /etc/snezhok/rclone.conf
ensure_environment_default SNEZHOK_OFFSITE_REMOTE "$(escape_environment_value "$OFFSITE_REMOTE")"
ensure_environment_default SNEZHOK_REQUIRE_OFFSITE_BACKUP "$REQUIRE_OFFSITE_BACKUP"
ensure_environment_default SNEZHOK_MAX_OFFSITE_BACKUP_AGE_HOURS 36
ensure_environment_default SNEZHOK_OFFSITE_STATUS_FILE /var/lib/snezhok-maintenance/offsite-replication.status
chown root:root "$environment_tmp"
chmod 0600 "$environment_tmp"
mv -f -- "$environment_tmp" "$environment_target"
environment_tmp=""

for unit in "$PLATFORM_ROOT"/infra/systemd/snezhok-*.service "$PLATFORM_ROOT"/infra/systemd/snezhok-*.timer; do
  [[ -f "$unit" ]] || { echo "systemd unit set is incomplete" >&2; exit 1; }
  install -o root -g root -m 0644 "$unit" "/etc/systemd/system/$(basename "$unit")"
done
chmod 0755 "$PLATFORM_ROOT"/scripts/deploy/*.sh "$PLATFORM_ROOT"/scripts/maintenance/*.sh \
  "$PLATFORM_ROOT"/scripts/monitoring/*.sh "$PLATFORM_ROOT"/scripts/livekit/*.sh
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/snezhok-*.service /etc/systemd/system/snezhok-*.timer

if $ENABLE_TIMERS; then
  systemctl enable --now \
    snezhok-backup.timer snezhok-restore-verify.timer snezhok-retention.timer \
    snezhok-monitor.timer snezhok-pitr-base.timer snezhok-pitr-restore-verify.timer \
    snezhok-media-mirror.timer
  effective_require_offsite=$(awk -F= '$1=="SNEZHOK_REQUIRE_OFFSITE_BACKUP" {print $2}' "$environment_target" | tail -1 | tr -d '"\r')
  if [[ "$effective_require_offsite" == "1" ]]; then
    rclone_config=/etc/snezhok/rclone.conf
    [[ -f "$rclone_config" && ! -L "$rclone_config" ]] || { echo "required off-site backup needs a regular $rclone_config" >&2; exit 1; }
    rclone_mode=$(stat -c '%a' "$rclone_config")
    (( (8#$rclone_mode & 077) == 0 )) || { echo "$rclone_config must not be group/world accessible" >&2; exit 1; }
    systemctl start snezhok-offsite-backup.service
    systemctl is-failed --quiet snezhok-offsite-backup.service && { echo "initial required off-site replication failed" >&2; exit 1; }
    systemctl enable --now snezhok-offsite-backup.timer
  fi
  echo "Snezhok maintenance services installed and timers enabled for $SOURCE_REVISION."
else
  echo "Snezhok maintenance services installed for $SOURCE_REVISION; inspect the environment, then rerun with --enable."
fi
