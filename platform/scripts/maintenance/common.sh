#!/usr/bin/env bash

# Shared safety helpers for host-side Snezhok maintenance. This file is sourced
# by scripts that already enable `set -Eeuo pipefail`.

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is not installed: $1"
}

require_absolute_safe_directory() {
  local value=$1
  local label=$2
  [[ "$value" == /* ]] || die "$label must be an absolute path"
  command -v realpath >/dev/null 2>&1 || die "realpath is required to validate $label"
  local canonical
  canonical=$(realpath -m -- "$value")
  [[ "$canonical" != "/" ]] || die "$label must not resolve to the filesystem root"
  [[ "$canonical" == "$value" ]] || die "$label must be canonical and contain no traversal or symbolic-link components (resolved: $canonical)"
}

require_matching_age_identity() {
  local recipient_file=$1
  local identity_file=$2
  require_recipient_file_permissions "$recipient_file"
  require_private_key_permissions "$identity_file"
  local configured derived
  configured=$(tr -d '[:space:]' <"$recipient_file")
  derived=$(age-keygen -y "$identity_file" | tr -d '[:space:]')
  [[ "$configured" == age1* && "$configured" == "$derived" ]] \
    || die "age recipient does not match the configured recovery identity"
}

require_private_key_permissions() {
  local path=$1
  [[ "$path" == /* ]] || die "identity file path must be absolute"
  [[ -f "$path" ]] || die "identity file does not exist: $path"
  [[ ! -L "$path" ]] || die "identity file must not be a symbolic link: $path"
  [[ -r "$path" ]] || die "identity file is not readable by the maintenance user: $path"
  local mode
  mode=$(stat -c '%a' "$path")
  (( (8#$mode & 077) == 0 )) || die "identity file must not be accessible by group or other users: $path (mode $mode)"
}

require_recipient_file_permissions() {
  local path=$1
  [[ "$path" == /* ]] || die "age recipient file path must be absolute"
  [[ -f "$path" ]] || die "age recipient file does not exist: $path"
  [[ ! -L "$path" ]] || die "age recipient file must not be a symbolic link: $path"
  local mode
  mode=$(stat -c '%a' "$path")
  (( (8#$mode & 022) == 0 )) || die "age recipient file must not be group/world writable: $path (mode $mode)"
}

resolved_platform_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P
}

compose_command() {
  local platform_root=$1
  local compose_file=$2
  shift 2
  docker compose --project-directory "$platform_root" --file "$compose_file" "$@"
}

path_is_within() {
  local child=$1
  local parent=$2
  [[ "$child" == "$parent" || "$child" == "$parent"/* ]]
}
