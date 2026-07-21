#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PLATFORM_ROOT=${PLATFORM_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd -P)}
ALERT_WEBHOOK_URL=${SNEZHOK_ALERT_WEBHOOK_URL:-}

result_file=$(mktemp)
cleanup() { rm -f -- "$result_file"; }
trap cleanup EXIT

if python3 "$PLATFORM_ROOT/scripts/livekit/connectivity-smoke.py" "$@" >"$result_file" 2>&1; then
  cat "$result_file"
  exit 0
fi

cat "$result_file" >&2
summary="Snezhok external call-connectivity probe failed"
logger --tag snezhok-external-monitor --priority daemon.err -- "$summary" 2>/dev/null || true
if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
  payload=$(python3 -c 'import json,sys; print(json.dumps({"text":sys.argv[1]}))' "$summary")
  curl --fail --silent --show-error --max-time 10 -H 'content-type: application/json' --data-binary "$payload" "$ALERT_WEBHOOK_URL" >/dev/null
fi
exit 1
