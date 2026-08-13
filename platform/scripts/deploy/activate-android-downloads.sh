#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

PLATFORM_ROOT=${PLATFORM_ROOT:-/home/merchedits/sites/snezhok-v3/platform}
NGINX_ROOT=${NGINX_ROOT:-/etc/nginx}
SITE_FILE=${SITE_FILE:-$NGINX_ROOT/sites-available/merchedits.xyz}
SNIPPET_FILE=$NGINX_ROOT/snippets/snezhok-android-download.conf
RELEASE_FILE=$PLATFORM_ROOT/runtime/releases/snezhok-current.apk
BACKUP_ROOT=/var/backups/snezhok/nginx-android-download-$(date -u +%Y%m%dT%H%M%SZ)

[[ $EUID -eq 0 ]] || { echo "activate-android-downloads.sh must run as root" >&2; exit 1; }
[[ "$PLATFORM_ROOT" == "/home/merchedits/sites/snezhok-v3/platform" ]] || { echo "unexpected platform root" >&2; exit 1; }
[[ -f "$SITE_FILE" && ! -L "$SITE_FILE" ]] || { echo "canonical Nginx site is missing" >&2; exit 1; }
[[ -f "$RELEASE_FILE" && ! -L "$RELEASE_FILE" ]] || { echo "published Android APK is missing" >&2; exit 1; }

mkdir -p "$BACKUP_ROOT"
cp -a "$SITE_FILE" "$BACKUP_ROOT/merchedits.xyz"
[[ ! -e "$SNIPPET_FILE" ]] || cp -a "$SNIPPET_FILE" "$BACKUP_ROOT/snezhok-android-download.conf"

rollback() {
  set +e
  cp -a "$BACKUP_ROOT/merchedits.xyz" "$SITE_FILE"
  if [[ -f "$BACKUP_ROOT/snezhok-android-download.conf" ]]; then
    cp -a "$BACKUP_ROOT/snezhok-android-download.conf" "$SNIPPET_FILE"
  else
    rm -f "$SNIPPET_FILE"
  fi
  nginx -t && systemctl reload nginx
}
on_error() {
  local status=$?
  rollback
  exit "$status"
}
trap on_error ERR

install -m 0644 /dev/stdin "$SNIPPET_FILE" <<'NGINX'
# The release publisher atomically replaces this regular file only after its
# size, SHA-256, source provenance, versionCode and signer have been verified.
# The stable domain entry uses GitHub's release CDN. The API keeps an explicit
# `/origin` range route as a recovery source for the Android client.
location = /chat/api/v1/client/android {
    add_header Cache-Control "no-store" always;
    return 302 https://github.com/merchedits/snezhok/releases/latest/download/snezhok-android.apk;
}
NGINX

include_line='    include /etc/nginx/snippets/snezhok-android-download.conf;'
if ! grep -qF "$include_line" "$SITE_FILE"; then
  anchor='    include /etc/nginx/snippets/merchedits-downloads.conf;'
  [[ $(grep -cF "$anchor" "$SITE_FILE") -eq 1 ]] || { echo "cannot locate the unique downloads include" >&2; exit 1; }
  sed -i "\|$anchor|a\\$include_line" "$SITE_FILE"
fi

runuser -u www-data -- test -r "$RELEASE_FILE"
nginx -t
systemctl reload nginx

expected_bytes=$(stat -c '%s' "$RELEASE_FILE")
headers=$(mktemp)
body=$(mktemp)
trap 'rm -f "$headers" "$body"' EXIT
redirect=''
for _ in $(seq 1 20); do
  redirect=$(curl --silent --show-error --resolve merchedits.xyz:443:127.0.0.1 \
    --output /dev/null --write-out '%{http_code}|%{redirect_url}' \
    https://merchedits.xyz/chat/api/v1/client/android)
  [[ "$redirect" == "302|https://github.com/merchedits/snezhok/releases/latest/download/snezhok-android.apk" ]] && break
  sleep 0.25
done
[[ "$redirect" == "302|https://github.com/merchedits/snezhok/releases/latest/download/snezhok-android.apk" ]]
curl --fail --location --silent --show-error --resolve merchedits.xyz:443:127.0.0.1 \
  --header 'Range: bytes=0-1048575' --dump-header "$headers" --output "$body" \
  https://merchedits.xyz/chat/api/v1/client/android
grep -qi '^HTTP/.* 206' "$headers"
grep -qi "^Content-Range: bytes 0-1048575/$expected_bytes" "$headers"
[[ $(stat -c '%s' "$body") -eq 1048576 ]]

trap - ERR
echo "direct resumable Android download is active; backup: $BACKUP_ROOT"
