#!/usr/bin/env bash
set -Eeuo pipefail

# Run as root once on the production host. This keeps encrypted recovery data on
# the dedicated storage filesystem and prepares the online age identity without
# ever printing private key material.
DEPLOY_USER="${SNEZHOK_DEPLOY_USER:-merchedits}"
STORAGE_ROOT="${SNEZHOK_STORAGE_ROOT:-/mnt/storage/snezhok-backups}"
BACKUP_ROOT="${SNEZHOK_BACKUP_ROOT:-/var/backups/snezhok}"
KEY_ROOT="${SNEZHOK_KEY_ROOT:-/etc/snezhok}"
FSTAB_LINE="${STORAGE_ROOT} ${BACKUP_ROOT} none bind 0 0"

if [[ "${EUID}" -ne 0 ]]; then
  echo "prepare-production-host.sh must run as root" >&2
  exit 1
fi

storage_mount="$(findmnt -T /mnt/storage -n -o TARGET)"
if [[ "${storage_mount}" != "/mnt/storage" ]]; then
  echo "/mnt/storage is not a dedicated mounted filesystem" >&2
  exit 1
fi

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq age coreutils >/dev/null

install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 0700 "${STORAGE_ROOT}" "${BACKUP_ROOT}" "${KEY_ROOT}"

if mountpoint -q "${BACKUP_ROOT}"; then
  fsroot="$(findmnt -n -o FSROOT --target "${BACKUP_ROOT}")"
  expected_fsroot="/${STORAGE_ROOT#/mnt/storage/}"
  if [[ "${fsroot}" != "${expected_fsroot}" ]]; then
    echo "${BACKUP_ROOT} is mounted from an unexpected source (${fsroot})" >&2
    exit 1
  fi
else
  mount --bind "${STORAGE_ROOT}" "${BACKUP_ROOT}"
fi

# Remove the malformed line produced by the interrupted interactive setup, then
# install one idempotent bind-mount entry.
sed -i '\#^/mnt/storage/snezhok-backupsn/#d' /etc/fstab
if ! grep -Fqx "${FSTAB_LINE}" /etc/fstab; then
  printf '%s\n' "${FSTAB_LINE}" >> /etc/fstab
fi

identity="${KEY_ROOT}/backup-age-identity.txt"
recipient="${KEY_ROOT}/backup-age-recipient.txt"
legacy_identity="/home/${DEPLOY_USER}/.config/snezhok/age.key"
if [[ ! -s "${identity}" ]]; then
  if [[ -s "${legacy_identity}" && ! -L "${legacy_identity}" ]]; then
    install -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 0600 "${legacy_identity}" "${identity}"
  else
    temp_directory="$(mktemp -d "${KEY_ROOT}/.age-key.XXXXXX")"
    temp_identity="${temp_directory}/identity"
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "${temp_directory}"
    chmod 0700 "${temp_directory}"
    runuser -u "${DEPLOY_USER}" -- age-keygen -o "${temp_identity}" >/dev/null 2>&1
    mv -f "${temp_identity}" "${identity}"
    rmdir "${temp_directory}"
  fi
fi
runuser -u "${DEPLOY_USER}" -- age-keygen -y "${identity}" > "${recipient}.tmp"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${recipient}.tmp"
chmod 0600 "${identity}"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${identity}"
chmod 0644 "${recipient}.tmp"
mv -f "${recipient}.tmp" "${recipient}"
if [[ -f "${legacy_identity}" ]] && cmp -s "${legacy_identity}" "${identity}"; then
  rm -f -- "${legacy_identity}"
fi

install -d -o 70 -g 70 -m 0700 "${BACKUP_ROOT}/wal"
install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 0700 \
  "${BACKUP_ROOT}/database" \
  "${BACKUP_ROOT}/pitr" \
  "${BACKUP_ROOT}/media"

mountpoint -q "${BACKUP_ROOT}"
test -s "${identity}"
test -s "${recipient}"
echo "Snezhok production recovery storage is ready."
