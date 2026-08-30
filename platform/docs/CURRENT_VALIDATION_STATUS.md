# Current validation status

This is the evidence ledger for the Priority 0/Priority 1 stabilization batch
completed on 2026-08-30. Source, type, or integration checks do not count as
physical Android evidence. Update a row only with revision-bound evidence.

## Locally verified in this batch

- Mobile TypeScript, 280 behavioral/unit tests, architecture ownership and
  source-size gates, Expo dependency alignment, and Expo Doctor.
- API TypeScript and focused call-history, notification, upload, search-index,
  safe-link-preview, configuration, and media-authorization tests.
- Web TypeScript, extracted reconciliation/outbox domain tests, and build.
- Contracts/migrations runtime decoding, search-index fallback, and PGlite
  integration paths.
- Production dependency audit is recorded separately in the release handoff.

## Physical evidence still open

No connected physical Android device was used for this batch. These rows are
therefore **not confirmed**, even where deterministic checks are green.

| Area | Devices/accounts | Required journey and failure injection | Evidence |
| --- | --- | --- | --- |
| Core messaging | Two accounts/two devices | cold/rapid send, edit, delete, reply, forward, reactions, read state, reconnect, process kill | video and sanitized diagnostics |
| Timeline anchor | Samsung A12 plus current Android | long cached chat; receive at bottom/history; keyboard open/close | frame trace and video |
| Attachments | Two accounts/two devices | image, mixed album, document, caption, original/HQ; airplane mode, process kill before/after completion, expired/revoked capability, API/worker restart, partial 10+ album, cancel/retry | both clients, worker/API logs, no duplicate IDs |
| Persistent download | Samsung A12 | download/open/share, background/resume, cancel/retry, app restart, cleanup | video and resulting URI/type |
| Multi-account | Two accounts on phone plus peer | add/switch during queued upload, switch back, refresh, revoke, sign out one, app-lock resume | owner-isolation diagnostics |
| Calls | Two devices/independent networks | audio/video, Wi-Fi/mobile handoff, UDP-blocked TURN/TLS, reconnect, routes, camera failure/retry, background/lock, notification actions, teardown and voice recovery | ICE path, video and logs |
| Accessibility | 360x800 and large font/display | login, inbox, search, composer, attachments, call, app lock, account modal | unclipped screenshots |
| Performance | Physical SM-A125F release build | Macrobenchmark cold start, Baseline Profile, inbox/chat, keyboard, long/media chat, pool | JSON and Perfetto traces |
| Update size/install | 32-bit and 64-bit devices | signed dual-ABI APK install/update, range resume, low-space/unknown-source paths | byte count, ABI and install result |

## Release interpretation

- A tester APK may use the focused lane in `DEVELOPMENT_WORKFLOW.md` but must
  be labelled as awaiting relevant rows above.
- A stable release must run `RELEASE_ENGINEERING.md`, `ANDROID_E2E.md`,
  `BACKGROUND_TRANSFERS.md`, `CALL_CONNECTIVITY.md`, and `PERFORMANCE.md`.
- If a physical run disagrees with a static test, device evidence wins and the
  static test must be replaced or strengthened.
