#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source-path=SCRIPTDIR
# shellcheck source=../maintenance/common.sh
source "$SCRIPT_DIR/../maintenance/common.sh"

source_cert=${1:-}
source_key=${2:-}
target_dir=${TURN_CERT_TARGET:-/etc/snezhok/livekit-tls}
turn_domain=${TURN_DOMAIN:-turn.merchedits.xyz}
turn_runtime_gid=${TURN_RUNTIME_GID:-65532}
restart=false
[[ ${3:-} == "--restart" ]] && restart=true

(( EUID == 0 )) || die "certificate installation must run as root"
[[ -f "$source_cert" && -f "$source_key" ]] || die "usage: $0 FULLCHAIN_PEM PRIVATE_KEY [--restart]"
require_absolute_safe_directory "$target_dir" TURN_CERT_TARGET
[[ "$turn_runtime_gid" =~ ^[0-9]+$ ]] || die "TURN_RUNTIME_GID must be a numeric group id"
for command in openssl install sha256sum mktemp stat; do require_command "$command"; done

source_key_mode=$(stat -Lc '%a' "$source_key")
(( (8#$source_key_mode & 077) == 0 )) \
  || die "source TURN private key must not be accessible by group or other users (mode $source_key_mode)"

openssl x509 -in "$source_cert" -noout -checkend 604800 >/dev/null \
  || die "TURN certificate expires in less than seven days"
openssl x509 -in "$source_cert" -noout -checkhost "$turn_domain" >/dev/null \
  || die "TURN certificate does not cover $turn_domain"
cert_public=$(openssl x509 -in "$source_cert" -pubkey -noout | sha256sum | awk '{print $1}')
key_public=$(openssl pkey -in "$source_key" -pubout 2>/dev/null | sha256sum | awk '{print $1}')
[[ "$cert_public" == "$key_public" ]] || die "TURN certificate and private key do not match"

[[ ! -L "$target_dir" ]] || die "TURN certificate target must not be a symbolic link: $target_dir"
mkdir -p "$target_dir"
[[ ! -L "$target_dir" ]] || die "TURN certificate target must not be a symbolic link: $target_dir"
chown root:"$turn_runtime_gid" "$target_dir"
chmod 0750 "$target_dir"
temporary_dir=$(mktemp -d "$target_dir/.install-XXXXXX")
trap 'rm -rf -- "$temporary_dir"' EXIT
install -m 0440 -o root -g "$turn_runtime_gid" "$source_cert" "$temporary_dir/fullchain.pem"
install -m 0440 -o root -g "$turn_runtime_gid" "$source_key" "$temporary_dir/privkey.pem"
mv -f -- "$temporary_dir/fullchain.pem" "$target_dir/fullchain.pem"
mv -f -- "$temporary_dir/privkey.pem" "$target_dir/privkey.pem"
log "installed a validated TURN certificate without exposing its private key"

if $restart; then
  platform_root=${PLATFORM_ROOT:-$(resolved_platform_root)}
  compose_command "$platform_root" "$platform_root/docker-compose.production.yml" \
    up -d --no-deps --force-recreate livekit
  log "recreated LiveKit with the renewed TURN certificate"
fi
