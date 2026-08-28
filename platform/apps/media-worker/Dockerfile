FROM node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37 AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/media-worker/package.json apps/media-worker/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
RUN npm ci --workspace=@snezhok/media-worker
COPY apps/media-worker apps/media-worker
RUN npm run build --workspace=@snezhok/media-worker

FROM node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37 AS production-dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/media-worker/package.json apps/media-worker/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
RUN npm ci --omit=dev --workspace=@snezhok/media-worker \
  && npm cache clean --force

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/merchedits/snezhok" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"
RUN sed -i 's|http://deb.debian.org/debian|http://ftp.ru.debian.org/debian|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update && apt-get install -y --no-install-recommends dumb-init ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=production-dependencies /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/media-worker/package.json ./apps/media-worker/package.json
COPY --from=build /workspace/apps/media-worker/dist ./apps/media-worker/dist
RUN mkdir -p /app/data && chown -R node:node /workspace /app/data
RUN NODE_ENV=test STORAGE_ROOT=/tmp/snezhok-media-toolchain node apps/media-worker/dist/toolchainVerification.js
USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/media-worker/dist/index.js"]
