FROM postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/merchedits/snezhok" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

RUN apk add --no-cache age coreutils
COPY apps/postgres/archive-wal.sh /usr/local/bin/snezhok-archive-wal
COPY apps/postgres/provision-runtime-roles.sh /usr/local/bin/snezhok-provision-roles
RUN chmod 0755 /usr/local/bin/snezhok-archive-wal /usr/local/bin/snezhok-provision-roles
