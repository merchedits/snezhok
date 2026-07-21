#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

REVISION=${1:-${SNEZHOK_SOURCE_REVISION:-}}
PUBLIC_HOST=${SNEZHOK_PUBLIC_HOST:-merchedits.xyz}
LOCAL_HTTPS_ADDRESS=${SNEZHOK_LOCAL_HTTPS_ADDRESS:-127.0.0.1}
API_ORIGIN=${SNEZHOK_API_ORIGIN:-http://127.0.0.1:3003/api/v1}

[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "exact 40-character source revision required" >&2; exit 1; }
[[ "$PUBLIC_HOST" =~ ^[A-Za-z0-9.-]+$ && "$LOCAL_HTTPS_ADDRESS" =~ ^[0-9A-Fa-f:.]+$ ]] || { echo "invalid verification endpoint" >&2; exit 1; }
for command in curl docker node; do command -v "$command" >/dev/null || { echo "required command missing: $command" >&2; exit 1; }; done

health=$(curl --fail --silent --show-error --max-time 10 "$API_ORIGIN/health")
node -e 'const body=JSON.parse(process.argv[1]); if(body.status!=="ready"||body.revision!==process.argv[2]) process.exit(1)' "$health" "$REVISION"
"$(dirname "${BASH_SOURCE[0]}")/verify-production-images.sh" "$REVISION"

tls_health=$(curl --fail --silent --show-error --max-time 10 \
  --resolve "$PUBLIC_HOST:443:$LOCAL_HTTPS_ADDRESS" "https://$PUBLIC_HOST/chat/api/v1/health")
node -e 'const body=JSON.parse(process.argv[1]); if(body.status!=="ready"||body.revision!==process.argv[2]) process.exit(1)' "$tls_health" "$REVISION"

manifest=$(curl --fail --silent --show-error --max-time 10 "$API_ORIGIN/client/android/manifest")
download_path=$(node -e 'const body=JSON.parse(process.argv[1]); if(!Number.isSafeInteger(body.bytes)||body.bytes<1024||!/^\/[A-Za-z0-9_./-]+$/.test(body.downloadUrl)||body.sourceRevision!==process.argv[2]) process.exit(1); process.stdout.write(body.downloadUrl)' "$manifest" "$REVISION")
range_result=$(curl --fail --silent --show-error --max-time 15 --range 0-1023 -o /dev/null \
  --write-out '%{http_code}|%{size_download}' --resolve "$PUBLIC_HOST:443:$LOCAL_HTTPS_ADDRESS" \
  "https://$PUBLIC_HOST/chat$download_path")
[[ "$range_result" == "206|1024" ]] || { echo "Android channel did not return the required 1024-byte range" >&2; exit 1; }
echo "production release verified locally through TLS for $REVISION"
