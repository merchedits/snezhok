# Snezhok

Snezhok is a private, self-hosted communication platform for a small circle of friends. Version 3 is a clean-slate implementation: a fast web client, a native Android client, a PostgreSQL API, durable media processing, and LiveKit-based calls and screen sharing.

The production source lives in [`platform/`](./platform). The older root-level application remains only as a migration source and rollback target until the v3 cutover has been accepted.

## Version 3

- Telegram-style direct and group messaging, media notes, attachment quality controls, search, pins, reactions, replies, edits, and offline recovery.
- Discord-style servers, categories, channels, friend requests, voice rooms, participant controls, and configurable screen sharing.
- Minimal responsive interface with a shared design system for web and Android.
- Invite-only authentication, revocable device sessions, privacy controls, sequenced realtime events, and resumable uploads.
- PostgreSQL persistence, immutable originals, optimized media derivatives, and an SFU call topology suitable for multiple participants.

## Development

```bash
cd platform
npm install
npm run typecheck
npm test
npm run build
```

The web client is served under `/chat/`; the API is namespaced under `/api/v1`. See [`platform/.env.example`](./platform/.env.example) for local configuration.

## Documentation

- [`platform/docs/PRODUCT.md`](./platform/docs/PRODUCT.md) — product scope and behavior
- [`platform/docs/DESIGN.md`](./platform/docs/DESIGN.md) — visual and interaction language
- [`platform/docs/ARCHITECTURE.md`](./platform/docs/ARCHITECTURE.md) — system boundaries and data flows
- [`platform/docs/MIGRATION.md`](./platform/docs/MIGRATION.md) — deterministic legacy import
- [`platform/docs/DEPLOYMENT.md`](./platform/docs/DEPLOYMENT.md) — release, rollback, backups, and Android distribution

Private use only.
