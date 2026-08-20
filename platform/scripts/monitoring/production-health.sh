#!/usr/bin/env bash
set -Eeuo pipefail

readonly STACK_DIR="${SNEZHOK_STACK_DIR:-${PLATFORM_ROOT:-/home/merchedits/sites/snezhok-v3/platform}}"
readonly BACKUP_DIR="${SNEZHOK_BACKUP_DIR:-${BACKUP_ROOT:-/var/backups/snezhok}}"
readonly MAX_BACKUP_AGE_HOURS="${SNEZHOK_MAX_BACKUP_AGE_HOURS:-30}"
readonly MAX_VERIFIED_BACKUP_AGE_HOURS="${SNEZHOK_MAX_VERIFIED_BACKUP_AGE_HOURS:-192}"
readonly MAX_DISK_PERCENT="${SNEZHOK_MAX_DISK_PERCENT:-85}"
readonly ALERT_WEBHOOK_URL="${SNEZHOK_ALERT_WEBHOOK_URL:-}"
readonly STATUS_FILE="${SNEZHOK_MONITOR_STATUS_FILE:-/var/lib/snezhok-maintenance/monitoring.status}"
readonly SOURCE_REVISION="${SNEZHOK_SOURCE_REVISION:-}"
readonly LOCAL_TLS_HOST="${SNEZHOK_LOCAL_TLS_HOST:-merchedits.xyz}"
readonly LOCAL_TLS_ADDRESS="${SNEZHOK_LOCAL_TLS_ADDRESS:-127.0.0.1}"
readonly RUN_EXTERNAL_CONNECTIVITY_CHECK="${SNEZHOK_RUN_EXTERNAL_CONNECTIVITY_CHECK:-0}"
readonly MAX_UNVERIFIED_BACKUP_AGE_HOURS="${SNEZHOK_MAX_UNVERIFIED_BACKUP_AGE_HOURS:-960}"
readonly MAX_INCOMPLETE_BACKUP_AGE_HOURS="${SNEZHOK_MAX_INCOMPLETE_BACKUP_AGE_HOURS:-48}"
readonly REQUIRE_OFFSITE_BACKUP="${SNEZHOK_REQUIRE_OFFSITE_BACKUP:-0}"
readonly MAX_OFFSITE_BACKUP_AGE_HOURS="${SNEZHOK_MAX_OFFSITE_BACKUP_AGE_HOURS:-36}"
readonly OFFSITE_STATUS_FILE="${SNEZHOK_OFFSITE_STATUS_FILE:-/var/lib/snezhok-maintenance/offsite-replication.status}"
readonly MAX_PUSH_QUEUE_AGE_SECONDS="${SNEZHOK_MAX_PUSH_QUEUE_AGE_SECONDS:-900}"

[[ "$LOCAL_TLS_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "invalid local TLS host" >&2; exit 2; }
[[ "$LOCAL_TLS_ADDRESS" =~ ^[0-9A-Fa-f:.]+$ ]] || { echo "invalid local TLS address" >&2; exit 2; }
[[ "$MAX_UNVERIFIED_BACKUP_AGE_HOURS" =~ ^[0-9]+$ ]] || { echo "invalid unverified backup age" >&2; exit 2; }
[[ "$MAX_INCOMPLETE_BACKUP_AGE_HOURS" =~ ^[0-9]+$ ]] || { echo "invalid incomplete backup age" >&2; exit 2; }
[[ "$MAX_OFFSITE_BACKUP_AGE_HOURS" =~ ^[0-9]+$ ]] || { echo "invalid off-site backup age" >&2; exit 2; }
[[ "$MAX_PUSH_QUEUE_AGE_SECONDS" =~ ^[0-9]+$ ]] || { echo "invalid push queue age" >&2; exit 2; }

failures=()
check() {
  local label="$1"
  shift
  if ! "$@" >/dev/null 2>&1; then failures+=("$label"); fi
}
container_healthy() {
  [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{if .State.Running}}healthy{{else}}stopped{{end}}{{end}}' "$1" 2>/dev/null)" == "healthy" ]]
}

check "api-readiness" curl --fail --silent --show-error --max-time 8 http://127.0.0.1:3003/api/v1/health
if [[ ! "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]]; then
  failures+=("source-revision-unconfigured")
else
  health_payload=$(curl --fail --silent --show-error --max-time 8 http://127.0.0.1:3003/api/v1/health 2>/dev/null || true)
  api_revision=$(sed -n 's/.*"revision":"\([0-9a-f]\{40\}\)".*/\1/p' <<<"$health_payload")
  [[ "$api_revision" == "$SOURCE_REVISION" ]] || failures+=("api-source-revision-mismatch")
  for container in snezhok-v3-app-1 snezhok-v3-job-worker-1 snezhok-v3-media-worker-1 snezhok-v3-postgres-1; do
    image_revision=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container" 2>/dev/null || true)
    [[ "$image_revision" == "$SOURCE_REVISION" ]] || failures+=("${container}-source-revision-mismatch")
  done
fi

if [[ "$REQUIRE_OFFSITE_BACKUP" == "1" ]]; then
  if [[ "$(systemctl show --property=LoadState --value snezhok-offsite-backup.service 2>/dev/null)" != "loaded" ]]; then
    failures+=("offsite-backup-service-missing")
  elif systemctl is-failed --quiet snezhok-offsite-backup.service; then
    failures+=("offsite-backup-service-failed")
  fi
  systemctl is-active --quiet snezhok-offsite-backup.timer || failures+=("offsite-backup-timer-inactive")
  offsite_status="$OFFSITE_STATUS_FILE"
  if [[ ! -s "$offsite_status" ]]; then
    failures+=("offsite-backup-missing")
  else
    offsite_epoch=$(stat -c '%Y' "$offsite_status" 2>/dev/null || echo invalid)
    if [[ ! "$offsite_epoch" =~ ^[0-9]+$ ]]; then
      failures+=("offsite-backup-status-invalid")
    else
      offsite_age_hours=$(( ($(date +%s) - offsite_epoch) / 3600 ))
      if (( offsite_age_hours > MAX_OFFSITE_BACKUP_AGE_HOURS )); then failures+=("offsite-backup-${offsite_age_hours}h-old"); fi
    fi
  fi
elif [[ "$REQUIRE_OFFSITE_BACKUP" != "0" ]]; then
  failures+=("offsite-backup-setting-invalid")
fi
check "postgres-container" container_healthy snezhok-v3-postgres-1
check "api-container" container_healthy snezhok-v3-app-1
check "job-worker-container" container_healthy snezhok-v3-job-worker-1
check "media-worker-container" container_healthy snezhok-v3-media-worker-1
check "livekit-signal-local-tls" curl --fail --silent --show-error --max-time 8 \
  --resolve "${LOCAL_TLS_HOST}:443:${LOCAL_TLS_ADDRESS}" "https://${LOCAL_TLS_HOST}/chat/livekit/"
check "certificate-expiry-local-tls" bash -c \
  "openssl s_client -servername '$LOCAL_TLS_HOST' -connect '$LOCAL_TLS_ADDRESS:443' </dev/null 2>/dev/null | openssl x509 -checkend 1209600 -noout"
if [[ "$RUN_EXTERNAL_CONNECTIVITY_CHECK" == "1" ]]; then
  check "external-turn-connectivity" python3 "$STACK_DIR/scripts/livekit/connectivity-smoke.py" --timeout 5
elif [[ "$RUN_EXTERNAL_CONNECTIVITY_CHECK" != "0" ]]; then
  failures+=("external-connectivity-setting-invalid")
fi

queue_age="$(docker exec snezhok-v3-postgres-1 psql -At -U snezhok -d snezhok -v ON_ERROR_STOP=1 -c "SELECT coalesce(extract(epoch from now()-min(created_at))::int,0) FROM media_jobs WHERE status='pending' AND available_at<=now();" 2>/dev/null || echo query-failed)"
if [[ ! "$queue_age" =~ ^[0-9]+$ ]] || (( queue_age > 900 )); then failures+=("media-queue-${queue_age}s"); fi
failed_jobs="$(docker exec snezhok-v3-postgres-1 psql -At -U snezhok -d snezhok -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM media_jobs WHERE status='failed' AND updated_at>now()-interval '1 hour';" 2>/dev/null || echo query-failed)"
if [[ ! "$failed_jobs" =~ ^[0-9]+$ ]] || (( failed_jobs > 0 )); then failures+=("media-failures-${failed_jobs}"); fi
failed_call_commands="$(docker exec snezhok-v3-postgres-1 psql -At -U snezhok -d snezhok -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM call_media_commands WHERE status='failed';" 2>/dev/null || echo query-failed)"
oldest_call_command="$(docker exec snezhok-v3-postgres-1 psql -At -U snezhok -d snezhok -v ON_ERROR_STOP=1 -c "SELECT coalesce(extract(epoch from now()-min(created_at))::int,0) FROM call_media_commands WHERE status IN ('pending','processing');" 2>/dev/null || echo query-failed)"
if [[ ! "$failed_call_commands" =~ ^[0-9]+$ ]] || (( failed_call_commands > 0 )); then failures+=("call-media-dead-letter-${failed_call_commands}"); fi
if [[ ! "$oldest_call_command" =~ ^[0-9]+$ ]] || (( oldest_call_command > 300 )); then failures+=("call-media-backlog-${oldest_call_command}s"); fi
push_queue_age="$(docker exec snezhok-v3-postgres-1 psql -At -U snezhok -d snezhok -v ON_ERROR_STOP=1 -c "SELECT coalesce(extract(epoch from now()-min(created_at))::int,0) FROM push_delivery_outbox WHERE status IN ('pending','processing','expanded');" 2>/dev/null || echo query-failed)"
recent_push_failures="$(docker exec snezhok-v3-postgres-1 psql -At -U snezhok -d snezhok -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM push_delivery_outbox WHERE status='failed' AND updated_at>now()-interval '1 hour';" 2>/dev/null || echo query-failed)"
if [[ ! "$push_queue_age" =~ ^[0-9]+$ ]] || (( push_queue_age > MAX_PUSH_QUEUE_AGE_SECONDS )); then failures+=("push-queue-${push_queue_age}s"); fi
if [[ ! "$recent_push_failures" =~ ^[0-9]+$ ]] || (( recent_push_failures > 0 )); then failures+=("push-failures-${recent_push_failures}"); fi

for unit in snezhok-backup.service snezhok-restore-verify.service snezhok-retention.service snezhok-pitr-base.service snezhok-pitr-restore-verify.service snezhok-media-mirror.service; do
  if [[ "$(systemctl show --property=LoadState --value "$unit" 2>/dev/null)" != "loaded" ]]; then
    failures+=("${unit%.service}-missing")
  elif systemctl is-failed --quiet "$unit"; then
    failures+=("${unit%.service}-failed")
  fi
done
for timer in snezhok-backup.timer snezhok-restore-verify.timer snezhok-retention.timer snezhok-pitr-base.timer snezhok-pitr-restore-verify.timer snezhok-media-mirror.timer; do
  if ! systemctl is-active --quiet "$timer"; then failures+=("${timer%.timer}-timer-inactive"); fi
done
archiver_failure_active="$(docker exec snezhok-v3-postgres-1 psql -At -U snezhok -d snezhok -v ON_ERROR_STOP=1 -c "SELECT CASE WHEN last_failed_time IS NOT NULL AND (last_archived_time IS NULL OR last_failed_time>last_archived_time) THEN 1 ELSE 0 END FROM pg_stat_archiver;" 2>/dev/null || echo query-failed)"
if [[ "$archiver_failure_active" != "0" ]]; then failures+=("wal-archive-unhealthy-${archiver_failure_active}"); fi
newest_base_marker="$(find "$BACKUP_DIR/pitr-base" -maxdepth 1 -type f -name '*.age.verified' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 || true)"
if [[ -z "$newest_base_marker" ]]; then
  failures+=("pitr-base-missing")
else
  base_marker="${newest_base_marker#* }"; base_file="${base_marker%.verified}"; base_epoch="${newest_base_marker%% *}"
  expected_base_hash="$(awk 'NR==1 {print $1}' "$base_marker" 2>/dev/null || true)"
  actual_base_hash="$(sha256sum "$base_file" 2>/dev/null | awk '{print $1}' || true)"
  if [[ ! "$expected_base_hash" =~ ^[0-9a-f]{64}$ || "$expected_base_hash" != "$actual_base_hash" ]]; then failures+=("pitr-base-checksum-invalid"); fi
  if awk -v now="$(date +%s)" -v then="$base_epoch" 'BEGIN { exit !((now-then)>691200) }'; then failures+=("pitr-base-stale"); fi
  restored_marker="$base_marker.restored"
  if [[ ! -s "$restored_marker" ]] || ! grep -Eq '^RESTORED_AT=[0-9]{8}T[0-9]{6}Z$' "$restored_marker" \
    || ! grep -Fxq "BASE_SHA256=$actual_base_hash" "$restored_marker" \
    || ! grep -Eq '^RECOVERY_TARGET_LSN=[0-9A-F]+/[0-9A-F]+$' "$restored_marker" \
    || ! grep -Eq '^RECOVERY_TARGET_WAL=[0-9A-F]{24}$' "$restored_marker" \
    || ! grep -Eq '^AUTHENTICATED_WAL_FILES=[1-9][0-9]*$' "$restored_marker"; then failures+=("pitr-restore-verification-missing"); fi
fi
media_sync="$(find "$BACKUP_DIR/media-objects" -maxdepth 1 -type f -name .last-success -mmin -20 -print -quit 2>/dev/null || true)"
if [[ -z "$media_sync" ]]; then failures+=("encrypted-media-mirror-stale"); fi

wal_configuration="$(docker exec snezhok-v3-postgres-1 psql -At -U snezhok -d snezhok -v ON_ERROR_STOP=1 -c "SELECT current_setting('archive_mode')||':'||(current_setting('archive_command')<>'(disabled)')::text;" 2>/dev/null || echo query-failed)"
if [[ "$wal_configuration" != "on:true" ]]; then failures+=("wal-archive-config-${wal_configuration}"); fi
wal_ready_old="$(docker exec -u postgres snezhok-v3-postgres-1 sh -c "find /var/lib/postgresql/data/pg_wal/archive_status -type f -name '*.ready' -mmin +10 | wc -l" 2>/dev/null || echo query-failed)"
if [[ ! "$wal_ready_old" =~ ^[0-9]+$ ]] || (( wal_ready_old > 0 )); then failures+=("wal-ready-backlog-${wal_ready_old}"); fi
if ! docker exec -u postgres snezhok-v3-postgres-1 sh -eu -c '
  latest=$(find /var/lib/postgresql/wal-archive -maxdepth 1 -type f -name "*.age" | sort | tail -n 1)
  test -n "$latest" && test -s "$latest.sha256"
  expected=$(awk "NR==2 {print \$1}" "$latest.sha256")
  actual=$(sha256sum "$latest" | awk "{print \$1}")
  test "$expected" = "$actual"
' >/dev/null 2>&1; then failures+=("wal-ciphertext-verification-failed"); fi

disk_percent="$(df -P "$STACK_DIR" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
if [[ ! "$disk_percent" =~ ^[0-9]+$ ]] || (( disk_percent >= MAX_DISK_PERCENT )); then failures+=("storage-${disk_percent:-unknown}-percent"); fi
backup_disk_percent="$(df -P "$BACKUP_DIR" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
backup_inode_percent="$(df -Pi "$BACKUP_DIR" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
if [[ ! "$backup_disk_percent" =~ ^[0-9]+$ ]] || (( backup_disk_percent >= MAX_DISK_PERCENT )); then failures+=("backup-storage-${backup_disk_percent:-unknown}-percent"); fi
if [[ ! "$backup_inode_percent" =~ ^[0-9]+$ ]] || (( backup_inode_percent >= MAX_DISK_PERCENT )); then failures+=("backup-inodes-${backup_inode_percent:-unknown}-percent"); fi

if ! mountpoint -q "$BACKUP_DIR"; then
  failures+=("backup-target-not-mounted")
else
  newest_complete="$(find "$BACKUP_DIR" -mindepth 2 -maxdepth 2 -type f -name .complete -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 || true)"
  newest_verified="$(find "$BACKUP_DIR" -mindepth 2 -maxdepth 2 -type f -name .verified -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 || true)"
  if [[ -z "$newest_complete" ]]; then
    failures+=("complete-backup-missing")
  else
    complete_epoch="${newest_complete%% *}"
    complete_age_hours="$(awk -v now="$(date +%s)" -v then="$complete_epoch" 'BEGIN { print int((now-then)/3600) }')"
    if (( complete_age_hours > MAX_BACKUP_AGE_HOURS )); then failures+=("complete-backup-${complete_age_hours}h-old"); fi
  fi
  if [[ -z "$newest_verified" ]]; then
    failures+=("verified-backup-missing")
  else
    verified_epoch="${newest_verified%% *}"
    age_hours="$(awk -v now="$(date +%s)" -v then="$verified_epoch" 'BEGIN { print int((now-then)/3600) }')"
    if (( age_hours > MAX_VERIFIED_BACKUP_AGE_HOURS )); then failures+=("verified-backup-${age_hours}h-old"); fi
  fi

  oldest_unverified="$(
    while IFS= read -r marker; do
      directory=${marker%/.complete}
      [[ -f "$directory/.verified" ]] || stat -c '%Y' "$marker"
    done < <(find "$BACKUP_DIR" -mindepth 2 -maxdepth 2 -type f -name .complete -print 2>/dev/null)
  )"
  if [[ -n "$oldest_unverified" ]]; then
    oldest_unverified_epoch=$(sort -n <<<"$oldest_unverified" | head -1)
    oldest_unverified_hours=$(( ($(date +%s) - oldest_unverified_epoch) / 3600 ))
    if (( oldest_unverified_hours > MAX_UNVERIFIED_BACKUP_AGE_HOURS )); then failures+=("unverified-backup-${oldest_unverified_hours}h-old"); fi
  fi

  oldest_incomplete_epoch="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '.incomplete-*' -printf '%T@\n' 2>/dev/null | sort -n | head -1 | cut -d. -f1)"
  if [[ "$oldest_incomplete_epoch" =~ ^[0-9]+$ ]]; then
    oldest_incomplete_hours=$(( ($(date +%s) - oldest_incomplete_epoch) / 3600 ))
    if (( oldest_incomplete_hours > MAX_INCOMPLETE_BACKUP_AGE_HOURS )); then failures+=("incomplete-backup-${oldest_incomplete_hours}h-old"); fi
  fi
fi

mkdir -p "$(dirname "$STATUS_FILE")"
if ((${#failures[@]} == 0)); then
  printf 'ok %s\n' "$(date --iso-8601=seconds)" >"$STATUS_FILE"
  exit 0
fi

summary="Snezhok production health failed: $(IFS=,; echo "${failures[*]}")"
printf 'failed %s %s\n' "$(date --iso-8601=seconds)" "$summary" >"$STATUS_FILE"
logger --tag snezhok-monitor --priority daemon.err -- "$summary"
if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
  payload="$(python3 -c 'import json,sys; print(json.dumps({"text":sys.argv[1]}))' "$summary")"
  if ! curl --fail --silent --show-error --max-time 10 -H 'content-type: application/json' --data-binary "$payload" "$ALERT_WEBHOOK_URL" >/dev/null; then
    printf 'alert-delivery-failed %s %s\n' "$(date --iso-8601=seconds)" "$summary" >"$STATUS_FILE"
    logger --tag snezhok-monitor --priority daemon.err -- "Snezhok alert delivery failed"
  fi
fi
exit 1
