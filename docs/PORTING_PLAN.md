# Native Android porting plan

## Invariants

- The existing React Native APK remains production until native parity is
  verified on a Samsung Galaxy A12-class device.
- Development builds use a non-production application ID and a debug key.
- `xyz.merchedits.snezhok` and the production signing key are introduced only
  at the signed migration gate.
- The Snezhok API remains authoritative. Telegram/MTProto identity, sessions,
  servers and credentials are removed, not proxied.
- Telegram rendering and interaction code may be retained where its domain
  dependencies can be separated cleanly.

## Target boundaries

```text
Snezhok UI (retained/adapted Telegram views)
             |
Snezhok domain models and use cases
             |
local SQLite projection + outbox
             |
REST + Socket.IO + resumable media + call adapter
             |
existing Snezhok API, storage, worker and LiveKit services
```

No UI component may call an MTProto controller directly after migration. Domain
interfaces make removal measurable and let the current API evolve without
rewriting message cells.

## Delivery gates

1. **Foundation** — provenance, licensing inventory, build toolchain, isolated
   preview package, Snezhok brand shell and reproducible debug build.
2. **Identity** — email/username/password login, secure session migration,
   language/theme settings and profile editing.
3. **Inbox** — saved messages, direct/group/server navigation, unread state,
   local projection and realtime resume.
4. **Messaging** — cursor history, composer/insets, reply, forward, reactions,
   selection, pin/delete audiences, optimistic outbox and notifications.
5. **Media** — compressed/HQ/original upload, progress, thumbnails, viewer,
   voice/video messages and downloads.
6. **Calls** — audited call dependency, audio routing, noise processing,
   group calls and screen sharing.
7. **Migration** — same signing identity, stored-session import, updater,
   rollback package and physical-device macrobenchmarks.
8. **Release** — source tag, source archive, SBOM/license report, signed APK and
   matching public manifest.

Each gate requires tests and a usable vertical slice. Large upstream subsystems
are deleted only after the Snezhok replacement is running, which keeps the
branch reviewable and avoids a flag-day rewrite.
