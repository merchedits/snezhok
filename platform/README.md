# Snezhok v3

Snezhok v3 is the clean-slate web and Android private messenger. It combines Telegram-style chats and media with Discord-style servers, voice channels and screen sharing.

Nothing in `platform/` imports legacy UI, state or calling code. The legacy application remains outside this directory only as a migration source and production rollback target.

## Repository

- `apps/api` — Fastify API, PostgreSQL persistence, realtime events, uploads and LiveKit authorization.
- `apps/web` — React/Vite browser client.
- `apps/mobile` — Expo CNG Android client compiled with native WebRTC modules.
- `packages/contracts` — shared protocol models and validation.
- `infra` — LiveKit, Nginx and Compose production configuration.
- `docs` — product, design, architecture, migration and deployment decisions.

## Local web/API development

```bash
npm install
npm run build --workspace=@snezhok/contracts
npm run dev
```

PostgreSQL and a development LiveKit server must be available. Copy `.env.example` to `.env` and replace every secret before starting.

## Android development

The mobile app requires a custom native build; Expo Go cannot load LiveKit WebRTC.

```bash
npm run prebuild --workspace=@snezhok/mobile
npm run android --workspace=@snezhok/mobile
```

Internal APK builds use the `preview` profile in `apps/mobile/eas.json`, or the generated Gradle wrapper for a fully local signed release.

## Required reading

- [Product specification](docs/PRODUCT.md)
- [Design language](docs/DESIGN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Migration](docs/MIGRATION.md)
- [Deployment](docs/DEPLOYMENT.md)

The design acceptance rule is simple: if a screen cannot be traced to an established Telegram or Discord interaction, it does not ship.
