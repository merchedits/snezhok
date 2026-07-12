# Snezhok v3 Architecture

## Clean-slate boundary

`platform/` is the new product. It does not import from the legacy `apps/web` or `apps/server` trees. The old application remains available only as a migration source and rollback target until the new release is accepted.

The clients share wire contracts and behavior, not UI implementations:

- `apps/web`: React and Vite browser client.
- `apps/mobile`: Expo CNG React Native Android client with native WebRTC modules.
- `apps/api`: Fastify API, authenticated Socket.IO gateway and background media coordinator.
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

There is no global-conversation special case. Legacy global messages migrate into `#general` in a default private server.

## Durable messaging

PostgreSQL is the source of truth. Every stream owns a monotonically increasing sequence. Creating a message performs three actions in one transaction:

1. Lock and increment the stream sequence.
2. Insert the message using a unique `(sender_id, client_message_id)` idempotency key.
3. Append an outbox event and per-user sync events.

Read state is `last_read_sequence`, not a timestamp. Clients can optimistically send with the client ID, replace the pending item with the committed record, and safely retry without duplication.

The realtime connection is a notification and low-latency delivery path. Durable state remains available through REST. Reconnect starts from the last acknowledged event cursor and falls back to a bootstrap/delta sync when the retained event window is exceeded.

## Client storage

The web client caches recent streams, messages, drafts and queued sends in IndexedDB. TanStack Query owns remote cache coordination; long lists are virtualized.

The Android client uses a native custom build, never Expo Go. Its storage and background boundaries support cached conversations, deterministic reconnect, queued sends, resumable transfers and foreground call/screen-capture services. Tokens are stored in platform-protected secure storage.

## Attachments

Uploads are resumable and persisted before they are attached to messages. The server verifies declared length and SHA-256, detects type from content, and moves completed blobs into an immutable content-addressed object tree.

The send modes are Data saver, Auto, High quality and Original. Original is byte-for-byte. Media variants are generated asynchronously with bounded concurrency. The initial private deployment uses a local filesystem behind an interface that can later target S3; MinIO is intentionally omitted to reduce memory use.

Nginx serves authorized immutable objects through an internal location after the API returns `X-Accel-Redirect`, preserving range requests and avoiding Node memory pressure.

## Calls and screen sharing

LiveKit replaces the legacy peer mesh and Socket.IO audio relay. The API verifies stream membership before issuing a short-lived room-scoped token. Clients enable adaptive stream, dynacast and simulcast, and expose explicit audio and screen-share presets.

The single-node private deployment uses:

- LiveKit signaling on loopback port 7880, proxied at `/chat/livekit/`.
- WebRTC TCP on 7881.
- WebRTC UDP mux on 7882.
- Authenticated embedded TURN/UDP on 3478.

The host firewall and router must forward those media ports. TURN/TLS on 443 is not enabled because Nginx already owns the single public 443 endpoint. Strict-firewall TURN/TLS would require a second public IP or an L4 SNI proxy.

Self-hosted calls receive WebRTC echo cancellation, automatic gain control and standard noise suppression. Enhanced proprietary cancellation is an optional licensed client processor, not a claim made by the base deployment.

## Runtime topology

The production stack is deliberately small:

- One application container.
- One PostgreSQL container with conservative memory settings.
- One host-networked LiveKit container.
- One bounded media job at a time inside the application deployment initially.
- Host Nginx for TLS, WebSocket proxying and authorized file delivery.

Redis is not mandatory on this single-node, low-memory server. Durable events, jobs and rate-limit state use PostgreSQL. Redis becomes appropriate only when the API or LiveKit is scaled to multiple nodes.

The existing LLM and media services share the host, so every new container has CPU and memory limits. Expensive transcoding must yield while a call is active.

## Security

- Invite-only registration.
- Argon2id credentials; imported bcrypt hashes upgrade after successful login.
- Short-lived access tokens and rotating opaque refresh tokens.
- Refresh tokens are hashed in PostgreSQL; web delivery uses a secure HttpOnly cookie and Android uses protected storage.
- Per-device session review and revocation.
- Strict origin checks, request schemas, quotas and rate limits.
- File magic-byte validation, decompression limits and forced download for active formats.
- LiveKit secrets and object paths never reach clients.
- Administrative membership, role and invite changes are audited.

## Versioning

HTTP routes are rooted at `/api/v1`. Realtime event names and payloads come from `@snezhok/contracts`. Breaking protocol changes require a new API version or a backwards-compatible migration window; clients must never infer database structure.
