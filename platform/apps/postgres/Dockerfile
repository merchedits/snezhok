FROM postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/merchedits/snezhok" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

RUN apk add --no-cache age coreutils su-exec \
  && sed -i 's/exec gosu postgres/exec su-exec postgres/g' \
    /usr/local/bin/docker-entrypoint.sh \
    /usr/local/bin/docker-ensure-initdb.sh \
  && rm -f /usr/local/bin/gosu \
  && if grep -F 'gosu postgres' /usr/local/bin/docker-entrypoint.sh /usr/local/bin/docker-ensure-initdb.sh; then exit 1; fi
COPY apps/postgres/archive-wal.sh /usr/local/bin/snezhok-archive-wal
COPY apps/postgres/provision-runtime-roles.sh /usr/local/bin/snezhok-provision-roles
RUN chmod 0755 /usr/local/bin/snezhok-archive-wal /usr/local/bin/snezhok-provision-roles
