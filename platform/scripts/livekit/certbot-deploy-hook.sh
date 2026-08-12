#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

lineage=${RENEWED_LINEAGE:-/etc/letsencrypt/live/turn.merchedits.xyz}
domains=" ${RENEWED_DOMAINS:-turn.merchedits.xyz} "
[[ "$domains" == *" turn.merchedits.xyz "* ]] || exit 0
[[ "$lineage" == /etc/letsencrypt/live/* ]] || {
  echo "unexpected Certbot lineage path" >&2
  exit 1
}

platform_root=/home/merchedits/sites/snezhok-v3/platform
exec env PLATFORM_ROOT="$platform_root" TURN_DOMAIN=turn.merchedits.xyz \
  "$platform_root/scripts/livekit/install-turn-certificate.sh" \
  "$lineage/fullchain.pem" "$lineage/privkey.pem" --restart
