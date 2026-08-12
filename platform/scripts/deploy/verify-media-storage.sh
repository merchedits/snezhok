#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PLATFORM_ROOT=${PLATFORM_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd -P)}
STORAGE_ROOT=${SNEZHOK_STORAGE_ROOT:-$PLATFORM_ROOT/data-v3/storage}
OBJECT_ROOT=$STORAGE_ROOT/objects
POSTGRES_CONTAINER=${SNEZHOK_POSTGRES_CONTAINER:-snezhok-v3-postgres-1}

for command in docker realpath stat; do command -v "$command" >/dev/null || { echo "required command missing: $command" >&2; exit 1; }; done
[[ -d "$OBJECT_ROOT" && ! -L "$STORAGE_ROOT" && ! -L "$OBJECT_ROOT" ]] \
  || { echo "canonical media object directory is missing or unsafe" >&2; exit 1; }

storage_root_real=$(realpath -e -- "$STORAGE_ROOT")
object_root_real=$(realpath -e -- "$OBJECT_ROOT")
[[ "$object_root_real" == "$storage_root_real/objects" ]] || { echo "media object root escaped storage root" >&2; exit 1; }

references=$(mktemp)
cleanup() { rm -f -- "$references"; }
trap cleanup EXIT

docker exec "$POSTGRES_CONTAINER" psql -At -U snezhok -d snezhok -v ON_ERROR_STOP=1 -F $'\t' \
  --command='SELECT storage_key,bytes FROM blobs ORDER BY storage_key;' >"$references"

verified=0
while IFS=$'\t' read -r storage_key expected_bytes; do
  [[ -n "$storage_key" ]] || continue
  [[ "$storage_key" =~ ^objects/[0-9a-f]{2}/[0-9a-f]{64}(-([0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$ ]] \
    || { echo "unsafe media storage key in database" >&2; exit 1; }
  [[ "$expected_bytes" =~ ^[0-9]+$ ]] || { echo "invalid media byte count in database" >&2; exit 1; }
  candidate=$(realpath -e -- "$STORAGE_ROOT/$storage_key") \
    || { echo "database-referenced media object is missing: $storage_key" >&2; exit 1; }
  [[ "$candidate" == "$object_root_real/"* && -f "$candidate" && ! -L "$candidate" ]] \
    || { echo "database-referenced media object is unsafe: $storage_key" >&2; exit 1; }
  actual_bytes=$(stat -c '%s' -- "$candidate")
  [[ "$actual_bytes" == "$expected_bytes" ]] \
    || { echo "database-referenced media size mismatch: $storage_key" >&2; exit 1; }
  if (( EUID == 0 )); then
    runuser -u www-data -- test -r "$candidate" \
      || { echo "Nginx cannot read database-referenced media: $storage_key" >&2; exit 1; }
  fi
  ((verified += 1))
done <"$references"

echo "verified $verified database-referenced media objects"
