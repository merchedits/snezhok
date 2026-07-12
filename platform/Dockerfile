FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/media-worker/package.json apps/media-worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json

RUN npm ci \
  --workspace=@snezhok/contracts \
  --workspace=@snezhok/api \
  --workspace=@snezhok/web

COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY apps/web apps/web

ARG PUBLIC_BASE_PATH=/chat/
ENV VITE_BASE_PATH=${PUBLIC_BASE_PATH}

RUN npm run build --workspace=@snezhok/contracts \
  && npm run build --workspace=@snezhok/api \
  && npm run build --workspace=@snezhok/web

FROM node:22-bookworm AS production-dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/media-worker/package.json apps/media-worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json

RUN npm ci --omit=dev \
  --workspace=@snezhok/contracts \
  --workspace=@snezhok/api \
  && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_PATH=/app/apps/web/dist

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --chown=node:node --from=production-dependencies /app/node_modules node_modules

COPY --chown=node:node packages/contracts/package.json packages/contracts/package.json
COPY --chown=node:node --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --chown=node:node --from=build /app/apps/api/dist apps/api/dist
COPY --chown=node:node --from=build /app/apps/api/migrations apps/api/migrations
COPY --chown=node:node --from=build /app/apps/web/dist apps/web/dist

RUN mkdir -p /app/data \
  && chown node:node /app/data

USER node

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/index.js"]
