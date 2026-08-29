FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS build

WORKDIR /app

RUN sed -i 's|http://deb.debian.org/debian|http://ftp.ru.debian.org/debian|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/media-worker/package.json apps/media-worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json

RUN npm ci \
  --workspace=@snezhok/contracts \
  --workspace=@snezhok/game-engine \
  --workspace=@snezhok/api \
  --workspace=@snezhok/web

COPY packages/contracts packages/contracts
COPY packages/game-engine packages/game-engine
COPY apps/api apps/api
COPY apps/web apps/web

ARG PUBLIC_BASE_PATH=/chat/
ENV VITE_BASE_PATH=${PUBLIC_BASE_PATH}

RUN npm run build --workspace=@snezhok/contracts \
  && npm run build --workspace=@snezhok/game-engine \
  && npm run build --workspace=@snezhok/api \
  && npm run build --workspace=@snezhok/web

FROM node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37 AS production-dependencies

WORKDIR /app

RUN sed -i 's|http://deb.debian.org/debian|http://ftp.ru.debian.org/debian|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/media-worker/package.json apps/media-worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json

RUN npm ci --omit=dev \
  --workspace=@snezhok/contracts \
  --workspace=@snezhok/game-engine \
  --workspace=@snezhok/api \
  && npm cache clean --force

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime

ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/merchedits/snezhok" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_PATH=/app/apps/web/dist

RUN sed -i 's|http://deb.debian.org/debian|http://ftp.ru.debian.org/debian|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app

COPY --chown=node:node --from=production-dependencies /app/node_modules node_modules
COPY --chown=node:node --from=production-dependencies /app/packages/game-engine/node_modules packages/game-engine/node_modules

COPY --chown=node:node packages/contracts/package.json packages/contracts/package.json
COPY --chown=node:node --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --chown=node:node packages/game-engine/package.json packages/game-engine/package.json
COPY --chown=node:node --from=build /app/packages/game-engine/dist packages/game-engine/dist
COPY --chown=node:node --from=build /app/apps/api/dist apps/api/dist
COPY --chown=node:node --from=build /app/apps/api/migrations apps/api/migrations
COPY --chown=node:node --from=build /app/apps/web/dist apps/web/dist

RUN mkdir -p /app/data \
  && chown node:node /app/data

USER node

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/index.js"]
