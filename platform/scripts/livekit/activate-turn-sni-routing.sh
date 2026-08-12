#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

(( EUID == 0 )) || { echo "run as root" >&2; exit 1; }

nginx_root=/etc/nginx
nginx_conf=$nginx_root/nginx.conf
stream_conf=$nginx_root/turn-sni-routing.conf
backup_root=/var/backups/snezhok/nginx-turn-$(date -u +%Y%m%dT%H%M%SZ)
mapfile -t tls_sites < <(grep -RlE '^[[:space:]]*listen (\[::\]:)?443 ssl' "$nginx_root/sites-enabled" | sort -u)
(( ${#tls_sites[@]} > 0 )) || { echo "no existing HTTPS listeners found" >&2; exit 1; }

mkdir -p "$backup_root/sites"
cp -a "$nginx_conf" "$backup_root/nginx.conf"
for site in "${tls_sites[@]}"; do
  resolved=$(readlink -f "$site")
  [[ "$resolved" == "$nginx_root/sites-available/"* ]] || {
    echo "unexpected HTTPS site target: $resolved" >&2
    exit 1
  }
  cp -a "$resolved" "$backup_root/sites/$(basename "$resolved")"
done
[[ ! -e "$stream_conf" ]] || cp -a "$stream_conf" "$backup_root/turn-sni-routing.conf"

rollback() {
  cp -a "$backup_root/nginx.conf" "$nginx_conf"
  for saved in "$backup_root"/sites/*; do
    cp -a "$saved" "$nginx_root/sites-available/$(basename "$saved")"
  done
  if [[ -f "$backup_root/turn-sni-routing.conf" ]]; then
    cp -a "$backup_root/turn-sni-routing.conf" "$stream_conf"
  else
    rm -f -- "$stream_conf"
  fi
  nginx -t && systemctl reload nginx
}
trap 'echo "TURN SNI activation failed; rolling Nginx back" >&2; rollback' ERR

for site in "${tls_sites[@]}"; do
  resolved=$(readlink -f "$site")
  perl -0pi -e 's/^\s*listen 443 ssl;[^\n]*$/    listen 127.0.0.1:8443 ssl proxy_protocol;/mg; s/^\s*listen \[::\]:443 ssl(?: ipv6only=on)?;[^\n]*\n?//mg' "$resolved"
done

if ! grep -q 'real_ip_header proxy_protocol;' "$nginx_conf"; then
  perl -0pi -e 's/http \{\n/http {\n\tset_real_ip_from 127.0.0.1;\n\treal_ip_header proxy_protocol;\n/' "$nginx_conf"
fi
if ! grep -qF 'include /etc/nginx/turn-sni-routing.conf;' "$nginx_conf"; then
  printf '\ninclude /etc/nginx/turn-sni-routing.conf;\n' >>"$nginx_conf"
fi

install -m 0644 /home/merchedits/sites/snezhok-v3/platform/infra/nginx/turn-sni-routing.conf.example "$stream_conf"
! grep -RInE '^[[:space:]]*listen (\[::\]:)?443 ssl' "$nginx_root/sites-enabled"
ss -lnt | grep -qE ':5349[[:space:]]'
nginx -t
systemctl reload nginx

for domain in merchedits.xyz reviewcut.online teamswift.xyz vault.teamswift.xyz vaultwarden.merchedits.xyz; do
  curl -sS --connect-timeout 5 --max-time 10 --resolve "$domain:443:127.0.0.1" -o /dev/null "https://$domain/"
done
printf '' | openssl s_client -connect 127.0.0.1:443 -servername turn.merchedits.xyz -verify_hostname turn.merchedits.xyz -verify_return_error >/dev/null 2>&1

trap - ERR
echo "TURN SNI routing active; rollback backup: $backup_root"
