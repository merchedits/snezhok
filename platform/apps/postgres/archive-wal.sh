#!/bin/sh
set -eu

source_path="$1"
wal_name="$2"
recipient_file=/run/secrets/backup_age_recipient
archive_root=/var/lib/postgresql/wal-archive

test -s "$recipient_file"
test -d "$archive_root"
printf '%s\n' "$wal_name" | grep -Eq '^([0-9A-F]{24}(\.partial|\.[0-9A-F]{8}\.backup)?|[0-9A-F]{8}\.history)$' || exit 2

recipient="$(cat "$recipient_file")"
destination="$archive_root/$wal_name.age"
temporary="$destination.incomplete"
checksum_file="$destination.sha256"
checksum_temporary="$checksum_file.incomplete"
source_checksum="$(sha256sum "$source_path" | awk '{print $1}')"

if test -s "$destination" && test -s "$checksum_file"; then
  stored_source="$(awk 'NR==1 {print $1}' "$checksum_file")"
  stored_cipher="$(awk 'NR==2 {print $1}' "$checksum_file")"
  actual_cipher="$(sha256sum "$destination" | awk '{print $1}')"
  if test "$stored_source" = "$source_checksum" && test "$stored_cipher" = "$actual_cipher"; then
    sync -f "$destination" "$checksum_file" "$archive_root"
    exit 0
  fi
fi

rm -f "$temporary" "$checksum_temporary" "$destination" "$checksum_file"
age --recipient "$recipient" --output "$temporary" "$source_path"
chmod 0600 "$temporary"
cipher_checksum="$(sha256sum "$temporary" | awk '{print $1}')"
printf '%s  source\n%s  ciphertext\n' "$source_checksum" "$cipher_checksum" >"$checksum_temporary"
chmod 0600 "$checksum_temporary"
sync -f "$temporary" "$checksum_temporary"
mv "$temporary" "$destination"
mv "$checksum_temporary" "$checksum_file"
sync -f "$destination" "$checksum_file" "$archive_root"
