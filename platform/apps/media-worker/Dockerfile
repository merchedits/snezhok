FROM node:22-bookworm AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/media-worker/package.json apps/media-worker/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --workspace=@snezhok/media-worker
COPY apps/media-worker apps/media-worker
RUN npm run build --workspace=@snezhok/media-worker

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=build /workspace/package.json /workspace/package-lock.json ./
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/media-worker/package.json ./apps/media-worker/package.json
COPY --from=build /workspace/apps/media-worker/dist ./apps/media-worker/dist
RUN mkdir -p /app/data && chown -R node:node /workspace /app/data
USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/media-worker/dist/index.js"]
