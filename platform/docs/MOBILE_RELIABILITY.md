# Mobile reliability and performance contract

Snezhok treats the Android application as the product authority. Changes to chat, media, calls, caching, notifications, or navigation must preserve these invariants.

## Correctness invariants

- A sender-generated `clientId` is stable across retries and uniquely identifies one logical send.
- HTTP responses, realtime delivery, bootstrap refreshes, cache hydration, and outbox retries must converge on one message.
- Read cursors only move forward and are clamped to the highest durable stream sequence.
- Optimistic UI updates are immediate, reversible, and never wait for a bootstrap refresh to disappear.
- Direct conversations are identified by account IDs, never display names.
- Cached state may be stale but must remain render-safe and must not log a user out.
- Attachment uploads can be resumed or retried without creating duplicate messages.
- A selected multi-photo activity batch is represented immediately by local
  placeholders. Each file exposes preparation/upload/commit state independently,
  and every completed Color Hunt photo is committed durably before the next one;
  the UI must never wait for the entire batch before revealing progress.
- Cached, optimistic, HTTP, and realtime attachment arrays are normalized before list classification or rendering. One malformed nested record must never unmount a chat.
- Stateful native media children use the durable attachment ID as their React identity. Recycler-position keys are not permitted for image, video, audio, or document subtrees.
- Every attachment subtree has a local JavaScript error boundary. A render failure records privacy-safe structural diagnostics and displays a compact fallback instead of reaching the application-level crash handler.
- Android `ApplicationExitInfo` and the native uncaught-exception hook are
  imported once on the next start. Only abnormal exits are retained; the crash
  hook keeps the exception type and one package/method frame, never exception
  text or a raw stack. New warning/error evidence is sent automatically after
  an authenticated online transition with an event-ID watermark and server-side
  deduplication, so a lost response cannot double-count a failure.
- Authenticated image thumbnails use `expo-image`'s native memory/disk cache with an authorization-aware source and a stable recycling key. Visible photo messages warm the corresponding authenticated full-size object, and an image displayed earlier in the same session reuses that native cache without showing a new synthetic spinner. Voice notes create an `expo-audio` player only after playback is requested and pass the authenticated remote source directly; the native audio implementation performs its own temporary download. Do not add a second JavaScript-managed file cache unless a measured platform defect requires it. Explicit user downloads remain ordinary files outside this playback path.
- Protected image, video, voice, and document reads refresh a nearly expired
  access token before native playback or transfer. A 401-like media failure
  rotates the session once and recreates the native consumer; it never falls
  back to an unauthenticated browser URL. Cached document downloads are reused
  only when their byte count matches the server attachment contract.
- Voice playback, voice recording, and LiveKit calls share one process-wide audio-session ownership arbiter. Calls preempt recording and playback; recording preempts playback; stale recorder/player cleanup is skipped after ownership changes. Every Android audio-mode mutation is serialized so an `expo-audio` unmount cannot reset LiveKit's `MODE_IN_COMMUNICATION` session. New native audio features must participate in this lease rather than calling audio-session configuration independently.
- Chat history paints from the SQLite snapshot already held in Zustand. The latest 300 messages per stream form the durable five-page working set, while cursor pagination remains authoritative for older history. Touching a conversation row starts a deduplicated SQLite warmup; notification/deep-link routes start the same cache-only read as soon as they mount. Navigation stays immediate, and network reconciliation waits until the native transition completes.
- `FlashList` is solely responsible for initial bottom anchoring through `startRenderingFromBottom`. Do not combine it with a duplicate first-frame overlay or an initial `scrollToEnd`, because competing position mechanisms cause extra row mounts and visible jumps.
- Android chat uses `adjustResize` as the sole viewport-resize owner. The header is outside the resizable timeline/composer region; adding a translating `KeyboardAvoidingView` there would double-apply the IME movement. Composer safe-area padding still interpolates from the keyboard controller's UI-thread progress and must not depend on post-animation `keyboardDidShow`/`keyboardDidHide` callbacks.
- Full-screen search/create flows use the keyboard controller's avoiding view,
  while scrolling profile and administration forms use its focused-input-aware
  scroll view. New text-entry surfaces must choose one of these primitives and
  retain a bottom offset; a plain `ScrollView` is insufficient on Android.
- Voice playback allocates its native player only after the user requests playback, starts after the authenticated source reports loaded, and uses the outgoing bubble's foreground/control colors rather than global secondary text colors. A failed player must be recreated on retry instead of reusing the failed native instance.
- An incoming-call notification is useful only for its exact server call. Its timestamp must be recent, its call ID must be sent back during token issuance, and neither a delayed tap nor a superseded call may create a new room.
- Android push registration is installation-scoped and idempotently refreshed on foreground/reconnect. A successful historical token is never assumed to remain valid after FCM rotates the native token.
- Durable realtime payload and cursor arrive in one validated envelope. One
  serial sync engine applies the repository projection first and advances the
  cursor afterward; duplicate or reordered envelopes are harmless and a failed
  projection triggers an authoritative snapshot without acknowledging the
  failed envelope.
- Message and attachment entities have one normalized repository each. Shared
  forwarded/activity attachment references update from one lifecycle event;
  older HTTP revisions cannot replace newer realtime or optimistic projections.
- Runtime capabilities are authenticated bootstrap data and server-enforced.
  UI gating improves clarity but is never treated as authorization.
- Background-transfer reconciliation is scoped per authenticated owner. A
  malformed WorkManager result is removed only from the native terminal queue,
  retains its stable upload/message identifiers and source URI, and returns to
  recoverable pending state. One malformed result cannot abort reconciliation
  of the remaining transfers.

## Samsung A12 performance budgets

The in-app diagnostics recorder evaluates the same constants defined in `src/diagnostics/performanceBudgets.ts`.

| Interaction | Budget |
| --- | ---: |
| Tab response (tap to committed destination) | 17 ms |
| Warm chat open | 150 ms |
| Cached cold chat open | 350 ms |
| Optimistic action acknowledgement | 100 ms |

Animations may continue beyond the response budget. The budget measures when the app acknowledges the interaction and commits the destination state, not the decorative animation duration.

## Benchmark fixture

A release candidate must be exercised on a 60 Hz, 4 GB-or-less Android device using a conversation containing at least:

- 5,000 text messages;
- 250 reactions;
- 100 replies;
- 50 multi-image albums;
- 20 short videos;
- 50 voice messages;
- pinned messages at both recent and old history positions.

Verify warm/cold opening, backward pagination, reply navigation, selection/deletion of 50 messages, forwarding, reconnect after airplane mode, upload cancellation, and a Wi-Fi-to-mobile-data call transition.

## Diagnostics privacy

Client reports contain bounded technical events only. Credentials, message contents, email addresses, account IDs, query strings, and full hosts are redacted before persistence. Reports are user-initiated from Settings → Diagnostics and are correlated with the server using a request ID.

## Release gate

Before publishing an APK:

1. Run `npm run architecture:check`, then mobile, API, media-worker, web, and
   contracts type checks and tests.
2. Build the signed release APK with minification and resource shrinking.
3. Verify application ID, version code, signing certificate, byte count, and SHA-256.
4. Verify resumable HTTP range delivery from the public endpoint.
5. Confirm API health, domain job-worker heartbeat/revision, database latency,
   realtime reconnect, LiveKit reachability, and media-worker queue health.

Functional Android automation is documented in
[ANDROID_E2E.md](./ANDROID_E2E.md). Its messaging and voice journeys exercise
the installed app without storing account credentials or introducing a server
test backdoor. Emulator evidence supplements but never replaces the physical
SM-A125F performance gate.
