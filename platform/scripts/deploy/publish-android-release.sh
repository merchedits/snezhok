#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 022

APK=${1:-}
MANIFEST=${2:-}
RELEASE_ROOT=${3:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)/runtime/releases}

[[ -f "$APK" && ! -L "$APK" && -f "$MANIFEST" && ! -L "$MANIFEST" ]] \
  || { echo "usage: publish-android-release.sh APK MANIFEST [RELEASE_ROOT]" >&2; exit 1; }
[[ "$RELEASE_ROOT" == /* && "$RELEASE_ROOT" != "/" ]] || { echo "RELEASE_ROOT must be an absolute non-root path" >&2; exit 1; }
[[ "$(realpath -m -- "$RELEASE_ROOT")" == "$RELEASE_ROOT" ]] || { echo "RELEASE_ROOT must be canonical" >&2; exit 1; }
for command in awk cmp node sha256sum stat install mv sync realpath; do command -v "$command" >/dev/null || { echo "required command missing: $command" >&2; exit 1; }; done

mapfile -t metadata < <(node - "$MANIFEST" "$RELEASE_ROOT/android-current.json" <<'NODE'
const fs = require("node:fs");
const [nextPath, currentPath] = process.argv.slice(2);
const next = JSON.parse(fs.readFileSync(nextPath, "utf8"));
const fail = (message) => { throw new Error(message); };
if (next.applicationId !== "xyz.merchedits.snezhok") fail("unexpected applicationId");
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(next.version)) fail("invalid semantic version");
if (!Number.isSafeInteger(next.versionCode) || next.versionCode < 1) fail("invalid versionCode");
if (!Number.isSafeInteger(next.bytes) || next.bytes < 1) fail("invalid byte count");
if (!/^[0-9a-f]{64}$/.test(next.sha256)) fail("invalid APK SHA-256");
if (!/^[0-9a-f]{64}$/.test(next.signingCertificateSha256)) fail("invalid signing certificate SHA-256");
if (!/^[0-9a-f]{40}$/.test(next.sourceRevision)) fail("sourceRevision must be an exact 40-character commit");
if (fs.existsSync(currentPath)) {
  const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
  if (next.versionCode <= current.versionCode) fail("versionCode must increase");
  if (next.applicationId !== current.applicationId) fail("applicationId changed");
  if (next.signingCertificateSha256 !== current.signingCertificateSha256) fail("signing certificate changed");
}
for (const value of [next.version, String(next.versionCode), String(next.bytes), next.sha256, next.sourceRevision]) console.log(value);
NODE
)
[[ ${#metadata[@]} -eq 5 ]] || { echo "manifest validation did not return complete metadata" >&2; exit 1; }
version=${metadata[0]}
expected_bytes=${metadata[2]}
expected_sha=${metadata[3]}
source_revision=${metadata[4]}
platform_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
node "$platform_root/scripts/compliance/verify-public-source.mjs" \
  --revision "$source_revision" --repository https://github.com/merchedits/snezhok
actual_bytes=$(stat -c '%s' "$APK")
actual_sha=$(sha256sum "$APK" | awk '{print $1}')
[[ "$actual_bytes" == "$expected_bytes" ]] || { echo "APK byte count differs from manifest" >&2; exit 1; }
[[ "$actual_sha" == "$expected_sha" ]] || { echo "APK SHA-256 differs from manifest" >&2; exit 1; }

mkdir -p "$RELEASE_ROOT"
versioned_apk="$RELEASE_ROOT/snezhok-$version.apk"
versioned_manifest="$RELEASE_ROOT/snezhok-$version.json"
if [[ -e "$versioned_apk" || -e "$versioned_manifest" ]]; then
  [[ -f "$versioned_apk" && ! -L "$versioned_apk" && -f "$versioned_manifest" && ! -L "$versioned_manifest" ]] \
    || { echo "incomplete immutable versioned release exists: $version" >&2; exit 1; }
  [[ "$(sha256sum "$versioned_apk" | awk '{print $1}')" == "$expected_sha" ]] \
    || { echo "existing versioned APK differs from candidate" >&2; exit 1; }
  cmp -s "$MANIFEST" "$versioned_manifest" || { echo "existing versioned manifest differs from candidate" >&2; exit 1; }
  versioned_exists=true
else
  versioned_exists=false
fi
apk_temporary="$RELEASE_ROOT/.snezhok-$version.apk.incomplete"
manifest_temporary="$RELEASE_ROOT/.snezhok-$version.json.incomplete"
current_apk_temporary="$RELEASE_ROOT/.snezhok-current.apk.incomplete"
current_manifest_temporary="$RELEASE_ROOT/.android-current.json.incomplete"
cleanup() { rm -f -- "$apk_temporary" "$manifest_temporary" "$current_apk_temporary" "$current_manifest_temporary"; }
trap cleanup EXIT

if ! $versioned_exists; then
  install -m 0644 "$APK" "$apk_temporary"
  install -m 0644 "$MANIFEST" "$manifest_temporary"
  sync -f "$apk_temporary" "$manifest_temporary"
  mv -- "$apk_temporary" "$versioned_apk"
  mv -- "$manifest_temporary" "$versioned_manifest"
fi
install -m 0644 "$versioned_apk" "$current_apk_temporary"
install -m 0644 "$versioned_manifest" "$current_manifest_temporary"
sync -f "$versioned_apk" "$versioned_manifest" "$current_apk_temporary" "$current_manifest_temporary"
# The manifest is the channel pointer and is deliberately published last.
mv -f -- "$current_apk_temporary" "$RELEASE_ROOT/snezhok-current.apk"
sync -f "$RELEASE_ROOT/snezhok-current.apk" "$RELEASE_ROOT"
mv -f -- "$current_manifest_temporary" "$RELEASE_ROOT/android-current.json"
sync -f "$RELEASE_ROOT/android-current.json" "$RELEASE_ROOT"
trap - EXIT
echo "published Snezhok Android $version from $source_revision atomically"
