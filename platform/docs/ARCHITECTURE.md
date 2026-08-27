# Snezhok v3 Architecture

The mandatory dependency, ownership, synchronization, validation, failure
isolation, testing, and migration rules are defined in
[`ENGINEERING_GUIDELINES.md`](./ENGINEERING_GUIDELINES.md). This document
describes the deployed product topology; it does not relax that engineering
contract.

## Clean-slate boundary

`platform/` is the new product. It does not import from the legacy `apps/web` or `apps/server` trees. The old application remains available only as a migration source and rollback target until the new release is accepted.

The clients share wire contracts and behavior, not UI implementations:

- `apps/web`: React and Vite browser client.
- `apps/mobile`: Expo CNG React Native Android client with native WebRTC modules.
- `apps/api`: Fastify request API and authenticated Socket.IO gateway. The same
  immutable image has a separate `job-worker` entry point for durable scheduled
  messages, push delivery, activity finalization, call-room cleanup, and
  reliability maintenance; those loops never run in the request process.
- `packages/contracts`: versioned request, response, model and realtime event contracts.
- `infra`: PostgreSQL, LiveKit and Nginx production configuration.

## Product domains

The durable model treats Chats and Servers as distinct concepts.

- Chats are direct or private-group threads.
- Servers contain ordered categories and text or voice channels.
- Every message belongs to exactly one stream: a chat or text channel.
- Voice channels and direct calls map to LiveKit rooms after authorization by the API.
- Users, credentials and device sessions are separate records.
- Settings have account-level defaults with per-server, channel and chat overrides.

Servers are currently a dormant product capability. Their API, contracts, PostgreSQL data, permissions, and client implementation remain preserved, while Android and web hide server navigation, search results, notifications, deep links, settings, and administrative controls through checked-in release capabilities in each client. This is a presentation/product gate, not a destructive schema migration. Re-enabling it requires reviewed client releases and renewed physical validation.

Optional product availability is also projected by the authenticated,
revisioned `RuntimeCapabilities` object in bootstrap. PostgreSQL owns these
switches. The API enforces them and the client uses them only to avoid presenting
an unavailable action; a forged or stale client cannot bypass the server gate.

## Client data and synchronization

The Android process has one authenticated transport, one session refresh
coordinator, normalized message and attachment repositories, a durable mutation
queue, and a bounded transfer manager. Socket delivery uses validated atomic
`sync:event` envelopes. A serial `SyncEngine` applies the domain projection
before committing its cursor, ignores duplicate/reordered envelopes, and falls
back to one authoritative snapshot if projection fails. A cursor is therefore
never an acknowledgement for data the client did not accept.

Mobile dependencies point inward: presentation invokes `src/application`
use cases; deterministic reducers live under `src/domains`; HTTP, realtime,
persistence, device-media and background-work adapters live under
`src/infrastructure`; `src/core` is the composition boundary. The executable
`npm run architecture:check` gate rejects inverted dependencies, direct UI
transport primitives, oversized source files, and global upload progress. The
only size exception is the dormant server route listed in
`ARCHITECTURE_EXCEPTIONS.md`.

PostgreSQL remains authoritative. SQLite is the account-scoped durable Android
projection; in-memory Zustand state is disposable. HTTP, optimistic writes,
cache hydration, and realtime all converge through the same revision-aware
repositories rather than maintaining independent attachment or message copies.

There is no global-conversation special case. Legacy global messages migrate into `#general` in a default private server.

## Durable messaging

PostgreSQL is the source of truth. Every stream owns a monotonically increasing sequence. Creating a message performs three actions in one transaction:

1. Lock and increment the stream sequence.
2. Insert the message using a unique `(sender_id, client_message_id)` idempotency key.
3. Append an outbox event and per-user sync events.

Read state is `last_read_sequence`, not a timestamp. Clients can optimistically send with the client ID, replace the pending item with the committed record, and safely retry without duplication.

The realtime connection is a notification and low-latency delivery path. Durable state remains available through REST. Reconnect starts from the last acknowledged event cursor and falls back to a bootstrap/delta sync when the retained event window is exceeded.

### Cooperative activities

Cooperative experiences are durable conversation objects introduced by migration `0018_cooperative_activities.sql`. Each activity owns exactly one ordinary `system` message anchor. Activity creation allocates the conversation's normal monotonic message sequence, so older clients retain a safe readable timeline item while 4.0 clients attach a viewer-filtered `activity` projection to that same message.

The API exposes creation under `/conversations/:conversationId/activities` and revisioned idempotent commands under `/activities/:id/commands`. Participants, entries, media links, command idempotency, and audit events are stored separately. Mutations publish personalized `message:created` or `message:updated` payloads through the existing durable per-recipient event log. Secret answers and locked media are filtered while building each recipient payload; realtime is never the privacy boundary.

Message history carries compact activity summaries. The authenticated activity-detail endpoint expands large living lists, drawings, and revealed capsules only when the Android card opens; this preserves cached-chat startup and keeps large cooperative payloads out of every realtime/history page.

Memory Capsule reveal is a server-time scheduler transition. Cooperative milestones derive from completed durable state and create one deterministic chat card, never a streak or mutable score. The first release restricts activities to two-person direct conversations. Movie List and Ideas Jar are unique living objects per conversation.

Draw & Guess uses an authorized ephemeral Socket.IO preview stream for throttled bounded vectors; guesses are accepted during that live preview, while the revisioned HTTP command remains the only durable final drawing. Color Hunt uses the ordinary media job table with the `color-collage` operation introduced by migration `0019_activity_collages.sql`. A participant may add the remaining photos in one bounded command. Nine ready source attachments produce one immutable, share-ready 2160 × 2160 PNG plus a lightweight WebP thumbnail in the media worker, and the activity scheduler advances the anchor revision and publishes the resulting attachment to both cached chats. The activity detail screen uses stale-while-revalidate rendering so each per-photo revision updates its tile without replacing the entire sheet with a loader. Assigned colors remain private while the hunt is active; the completed activity view exposes each participant's assignment so the durable result is understandable without leaking game state early.

Turn-based chat games use the pure `packages/game-engine` domain shared by API and Android. PostgreSQL remains authoritative: every move is an idempotent revisioned activity command, is revalidated by the API, updates the same chat anchor, and survives reconnect or process death. The package owns deterministic Tic-tac-toe, chess, Russian checkers, Battleship, and 8-ball rules; chess delegates legal move/check/draw evaluation to the pinned BSD-licensed `chess.js` package. Battleship fleets remain in participant-private state until completion. A two-person rematch handshake reuses the anchor, alternates the first seat, preserves series score and completed-round history, and clears the previous terminal timestamp only when both players accept. Migration `0027_cooperative_games.sql` extends the durable activity type constraint.

## Client storage

The web client caches recent streams, messages, drafts and queued sends in IndexedDB. TanStack Query owns remote cache coordination; long lists are virtualized.

The Android client uses a native custom build, never Expo Go. Its storage and background boundaries support cached conversations, deterministic reconnect, queued sends, resumable transfers and foreground call/screen-capture services. Tokens are stored in platform-protected secure storage.

## Attachments

Uploads are resumable and persisted before they are attached to messages. The server verifies declared length and SHA-256, detects type from content, and moves completed blobs to immutable generation-specific object keys. PostgreSQL deduplicates logical attachments by checksum; generation-specific physical keys prevent a stale collector from deleting a newly committed object that happens to contain identical bytes.

The Android attachment drawer defaults to adaptive compressed media and exposes one High quality toggle. Selecting Upload file is the byte-for-byte original path; Take a photo captures directly into the same resumable upload flow and strips location metadata. Media variants are generated asynchronously with bounded concurrency. The initial private deployment uses a local filesystem behind an interface that can later target S3; MinIO is intentionally omitted to reduce memory use.

Nginx serves authorized immutable objects through an internal location after the API returns `X-Accel-Redirect`, preserving range requests and avoiding Node memory pressure.

All API message projections use the database `attachment_transport_payload`
function. Upload completion, history, bootstrap, realtime, forwarding, and
lifecycle updates therefore expose one contract instead of independently
reconstructing attachment JSON. A deferred database invariant verifies the
allowed message/attachment shapes at transaction commit: text and system
messages have no attachments, voice and video notes have exactly one matching
attachment, and media/file albums contain one through ten items.

The Android transport boundary decodes each message and each nested attachment
independently. Compatible legacy attachment records are repaired to canonical
authenticated file URLs; irrecoverable nested records are dropped without
discarding neighboring messages. SQLite applies the same rule, quarantines
metadata about damaged rows, removes the bad payload, and continues rendering
the healthy cached window. Quarantine records never retain message text, URLs,
or attachment metadata.

Activity media reuses the same immutable attachments and upload jobs. File authorization joins the activity participant and reveal state in addition to normal ownership rules; possessing a guessed file URL cannot bypass a secret reveal. Orphan collection treats activity attachment links as live references.

## Calls and screen sharing

LiveKit replaces the legacy peer mesh and Socket.IO audio relay. The API verifies stream membership before issuing a short-lived room-scoped token. Clients enable adaptive stream, dynacast and simulcast, and expose explicit audio and screen-share presets.

The single-node private deployment uses:

- LiveKit signaling on loopback port 7880, proxied at `/chat/livekit/`.
- WebRTC TCP on 7881.
- WebRTC UDP mux on 7882.
- Authenticated embedded TURN/UDP on 3478 and TURN/TLS advertised at `turn.merchedits.xyz:443` through the documented L4 SNI routing topology.

The host firewall and router must forward those media ports. Strict-firewall TURN/TLS shares public port 443 through an L4 SNI proxy that routes the TURN hostname separately from HTTPS; its certificate, DNS, router, and firewall prerequisites are release-gated and verified by the connectivity smoke test.

Self-hosted calls receive WebRTC echo cancellation, automatic gain control and standard noise suppression. Enhanced proprietary cancellation is an optional licensed client processor, not a claim made by the base deployment.

## Runtime topology

The production stack is deliberately small:

- One application container.
- One PostgreSQL container with conservative memory settings.
- One host-networked LiveKit container.
- One separately supervised bounded domain job worker and one media worker.
- Host Nginx for TLS, WebSocket proxying and authorized file delivery.

Redis is not mandatory on this single-node, low-memory server. Durable events, jobs and rate-limit state use PostgreSQL. Redis becomes appropriate only when the API or LiveKit is scaled to multiple nodes.

Android abnormal-exit evidence is consumed on the next launch and automatically
delivered after authentication. The server stores only deduplicated event hashes
and daily aggregates by application version, Android version, device model,
severity, and sanitized structural signature. It never stores a raw report,
message text, user ID, email, URL, or token; event hashes and aggregates expire
after 90 days.

The existing LLM and media services share the host, so every new container has CPU and memory limits. Expensive transcoding must yield while a call is active.

## Security

- Public email, username, and password registration with strict rate limits.
- Argon2id credentials; imported bcrypt hashes upgrade after successful login.
- Short-lived access tokens and rotating opaque refresh tokens.
- Refresh tokens are hashed in PostgreSQL; web delivery uses a secure HttpOnly cookie and Android uses protected storage.
- Per-device session review and revocation.
- Strict origin checks, request schemas, quotas and rate limits.
- File magic-byte validation, decompression limits and forced download for active formats.
- LiveKit secrets and object paths never reach clients.
- Administrative membership and role changes are audited.

## Versioning

HTTP routes are rooted at `/api/v1`. Realtime event names and payloads come from `@snezhok/contracts`. Breaking protocol changes require a new API version or a backwards-compatible migration window; clients must never infer database structure.
