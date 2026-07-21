#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

revision=${1:-${IMAGE_TAG:-}}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo "IMAGE_TAG must be the exact 40-character public source revision" >&2; exit 1; }
for image in snezhok-v3-app snezhok-v3-media-worker snezhok-v3-postgres; do
  reference="$image:$revision"
  actual=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$reference")
  source=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' "$reference")
  [[ "$actual" == "$revision" ]] || { echo "$reference has mismatched source revision label" >&2; exit 1; }
  [[ "$source" == "https://github.com/merchedits/snezhok" ]] || { echo "$reference has mismatched source repository label" >&2; exit 1; }
done
echo "production image provenance verified for $revision"
