#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

REVISION=${1:-}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PLATFORM_ROOT=${PLATFORM_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd -P)}
COMPOSE_FILE=${COMPOSE_FILE:-$PLATFORM_ROOT/docker-compose.production.yml}
BUILD_NETWORK=${SNEZHOK_DOCKER_BUILD_NETWORK:-host}

[[ $EUID -eq 0 ]] || { echo "deploy-production.sh must run as root" >&2; exit 1; }
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "exact 40-character public source revision required" >&2; exit 1; }
[[ "$BUILD_NETWORK" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "invalid Docker build network" >&2; exit 1; }
[[ "$PLATFORM_ROOT" == "/home/merchedits/sites/snezhok-v3/platform" ]] \
  || { echo "deployment must run from the canonical production checkout" >&2; exit 1; }
[[ -f "$PLATFORM_ROOT/.env" && ! -L "$PLATFORM_ROOT/.env" ]] || { echo "protected production .env is missing" >&2; exit 1; }
env_mode=$(stat -c '%a' "$PLATFORM_ROOT/.env")
(( (8#$env_mode & 077) == 0 )) || { echo "production .env must not be group/world accessible" >&2; exit 1; }
configured_revision=$(awk -F= '$1=="IMAGE_TAG" {print $2}' "$PLATFORM_ROOT/.env" | tail -1 | tr -d '\r')

for command in docker curl git node systemctl; do command -v "$command" >/dev/null || { echo "required command missing: $command" >&2; exit 1; }; done
docker compose version >/dev/null
systemctl is-enabled --quiet snezhok-backup.timer || { echo "maintenance timers must be installed before deployment" >&2; exit 1; }
checkout_revision=$(git -c safe.directory="$PLATFORM_ROOT" -C "$PLATFORM_ROOT" rev-parse --verify HEAD)
[[ "$checkout_revision" == "$REVISION" ]] || { echo "production checkout does not match the requested revision" >&2; exit 1; }
[[ -z "$(GIT_OPTIONAL_LOCKS=0 git -c safe.directory="$PLATFORM_ROOT" -C "$PLATFORM_ROOT" status --porcelain --untracked-files=normal)" ]] \
  || { echo "production checkout has uncommitted or untracked inputs" >&2; exit 1; }
node "$PLATFORM_ROOT/scripts/compliance/verify-public-source.mjs" \
  --revision "$REVISION" --repository https://github.com/merchedits/snezhok

# The recovery point is made from the still-running release. Require its
# image tag and maintenance provenance to remain current until the synchronized
# backup has restored the old services. Switching IMAGE_TAG earlier would make
# Compose try to restore an image that has not been built yet.
current_health=$(curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3003/api/v1/health)
current_revision=$(node -e 'const body=JSON.parse(process.argv[1]); if(!/^[0-9a-f]{40}$/.test(body.revision)) process.exit(1); process.stdout.write(body.revision)' "$current_health")
[[ "$configured_revision" == "$current_revision" ]] || { echo "IMAGE_TAG in .env does not match the running release" >&2; exit 1; }
maintenance_revision=$(awk -F= '$1=="SNEZHOK_SOURCE_REVISION" {print $2}' /etc/snezhok/maintenance.env | tail -1 | tr -d '\r')
[[ "$maintenance_revision" == "$current_revision" ]] \
  || { echo "maintenance provenance does not match the currently running release" >&2; exit 1; }

echo "creating a synchronized encrypted pre-deployment recovery point"
systemctl start snezhok-backup.service
systemctl is-failed --quiet snezhok-backup.service && { echo "pre-deployment backup failed" >&2; exit 1; }

set_image_tag() {
  local revision=$1
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$revision/" "$PLATFORM_ROOT/.env"
  chmod 0600 "$PLATFORM_ROOT/.env"
  [[ "$(awk -F= '$1==\"IMAGE_TAG\" {print $2}' "$PLATFORM_ROOT/.env" | tail -1 | tr -d '\r')" == "$revision" ]]
}
deployment_succeeded=false
rollback_tag() {
  if ! $deployment_succeeded; then
    set +e
    set_image_tag "$current_revision"
    docker compose --project-directory "$PLATFORM_ROOT" --file "$COMPOSE_FILE" up -d --no-build app media-worker >/dev/null 2>&1
  fi
}
trap rollback_tag EXIT
set_image_tag "$REVISION"

cd "$PLATFORM_ROOT"
echo "building immutable revision-tagged production images"
docker build --network "$BUILD_NETWORK" --build-arg SOURCE_REVISION="$REVISION" \
  --build-arg PUBLIC_BASE_PATH=/chat/ -t "snezhok-v3-app:$REVISION" -f Dockerfile .
docker build --network "$BUILD_NETWORK" --build-arg SOURCE_REVISION="$REVISION" \
  -t "snezhok-v3-media-worker:$REVISION" -f apps/media-worker/Dockerfile .
docker build --network "$BUILD_NETWORK" --build-arg SOURCE_REVISION="$REVISION" \
  -t "snezhok-v3-postgres:$REVISION" -f apps/postgres/Dockerfile .
"$SCRIPT_DIR/verify-production-images.sh" "$REVISION"

echo "applying migrations, provisioning least-privilege roles, and waiting for health"
docker compose --project-directory "$PLATFORM_ROOT" --file "$COMPOSE_FILE" up -d --wait --wait-timeout 180
"$SCRIPT_DIR/verify-production-release.sh" "$REVISION"
docker compose --project-directory "$PLATFORM_ROOT" --file "$COMPOSE_FILE" rm -f migrate db-provision >/dev/null
SNEZHOK_SOURCE_REVISION="$REVISION" "$SCRIPT_DIR/install-maintenance.sh" "$REVISION" --enable

deployment_succeeded=true
trap - EXIT
echo "production deployment completed and verified for $REVISION"
