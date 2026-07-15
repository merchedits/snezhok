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

1. Run mobile, API, media-worker, and contracts type checks and tests.
2. Build the signed release APK with minification and resource shrinking.
3. Verify application ID, version code, signing certificate, byte count, and SHA-256.
4. Verify resumable HTTP range delivery from the public endpoint.
5. Confirm API health, database latency, realtime reconnect, LiveKit reachability, and media-worker queue health.
