# Snezhok engineering and architecture guidelines

This document is the mandatory engineering constitution for `platform/`. It
turns the product, reliability, performance, design, and operations contracts
into one enforceable architecture. A change that violates a **MUST** or **MUST
NOT** rule is not ready to merge or release.

Snezhok is an Android-first messenger. Correctness under retries, reconnects,
process death, malformed media, and slow devices is part of the feature. A
screen that looks complete but can lose, duplicate, hide, or crash on user data
is incomplete.

## 1. Order of authority

When requirements conflict, use this order:

1. Preserve user data, authorization boundaries, and recovery compatibility.
2. Preserve durable protocol and database correctness.
3. Preserve a usable cached/offline product and honest operation state.
4. Meet the physical-device reliability and performance budgets.
5. Follow the product and design language.
6. Prefer implementation convenience last.

Never silently weaken a higher rule to satisfy a lower one. Document an
intentional exception with its owner, expiry condition, regression test, and
rollback plan.

### Evidence-based solution selection

Every non-mechanical product or engineering change **MUST** follow
[DEVELOPMENT_WORKFLOW.md](./DEVELOPMENT_WORKFLOW.md) before implementation.
The evidence pass is proportional, but it is not optional: trace the existing
root cause, open current authoritative guidance, inspect established interaction
precedents when relevant, and evaluate mature native/open-source reuse before
choosing custom code. A new core dependency or costly-to-reverse architectural
choice **MUST** include a decision record under `docs/decisions/` with rejected
alternatives, license/security evidence, consequences, rollback, and validation.

Do not keep a weak path merely because it already exists, and do not adopt a
popular library solely from search snippets, download counts, or a demo. The
choice must account for Snezhok's offline, retry, process-death, accessibility,
Android-scale, performance, and recovery requirements.

## 2. Architectural shape

Code is divided into the following dependency layers:

```text
UI / presentation
        |
application use cases
        |
domain repositories and deterministic reducers
        |
infrastructure adapters (HTTP, Socket.IO, SQLite, WorkManager, LiveKit)
        |
versioned contracts and durable server state
```

- UI **MUST NOT** call `fetch`, SQLite, SecureStore, WorkManager, or Socket.IO
  directly.
- A screen **MUST** compose view models and invoke application use cases. It
  **MUST NOT** own synchronization, retry, upload, or authentication policy.
- Domain code **MUST** be deterministic and independently testable. It **MUST
  NOT** import React, React Native, Expo, Fastify, PostgreSQL, or LiveKit.
- Infrastructure adapters **MUST** translate platform failures into the shared
  typed error model. They **MUST NOT** mutate UI state directly.
- Shared contracts **MUST NOT** depend on an application workspace.
- Cross-domain imports are allowed only through a domain's public entrypoint.
  Reaching into another domain's internal files is prohibited.

New mobile code belongs under `src/core`, `src/domains`, `src/application`,
`src/infrastructure`, or `src/ui`. Application modules may coordinate domain
reducers, repositories and infrastructure ports, but may not import React or
rendering code. Existing code is migrated vertically; directory movement alone
is not a rewrite.

## 3. Ownership and sources of truth

PostgreSQL is authoritative for durable remote state. SQLite is the Android
durable local projection. In-memory state is a replaceable projection for the
current process. Realtime delivery is a low-latency hint, never a second source
of truth.

Every durable entity **MUST** have exactly one client repository responsible
for normalization, ordering, merge rules, persistence, and deletion. The same
entity **MUST NOT** be independently reconciled by a screen, socket handler,
and store action.

The client synchronization path is:

```text
validated server payload
  -> deterministic domain reducer
  -> one SQLite transaction
  -> narrow in-memory projection update
  -> subscribed view models
```

- Entities are keyed by durable IDs. Recycler position, array index, display
  name, URL, and timestamp are not identities.
- All sequence and revision cursors move monotonically.
- An older HTTP response **MUST NOT** overwrite a newer realtime or optimistic
  revision.
- Account ownership accompanies every cache, transfer, mutation, and native
  result. A late response from another session is discarded.
- Cache corruption or an unsupported cached version is contained per record or
  rebuilt from the server; it **MUST NOT** expose another account or crash the
  authenticated shell.

## 4. Contracts and validation

TypeScript types do not validate network or persisted data.

- Every HTTP response, realtime payload, native-module result, persisted queue
  record, and versioned cache root **MUST** cross a runtime schema boundary.
- Schemas live with `@snezhok/contracts` when shared by server and clients.
- Parsers **MUST** reject or quarantine an invalid record with bounded,
  privacy-safe diagnostics. A malformed attachment or activity **MUST NOT**
  unmount its message, chat, or application.
- Protocol additions are backwards compatible within `/api/v1`. Required
  breaking fields require a new API version or a documented compatibility
  window.
- Unknown additive fields are ignored. Unknown enum variants render a safe
  fallback and are retained where round-tripping matters.
- Database migrations are forward-only, transactional where PostgreSQL permits,
  idempotently tracked, and tested from the oldest supported production schema.

## 5. Network and authentication transport

There is one mobile transport and one refresh coordinator.

- All HTTP requests use the shared transport for base URL, request IDs,
  authentication, timeout, cancellation, response parsing, diagnostics, and
  error classification.
- Concurrent `401` responses join one refresh operation. A refresh result is
  applied only to the session generation that started it.
- Retry policy is explicit per operation. Safe reads may retry transient
  failures. Mutations retry only with a stable idempotency key.
- Redirects carrying authentication or upload capabilities are disabled unless
  the destination is explicitly verified.
- Screens cancel obsolete reads on route/account/filter changes.
- Transport errors retain machine-readable category, retryability, HTTP status,
  request ID, and a localized presentation code without copying private payloads.

## 6. Durable mutations and optimistic UI

Every user mutation declares one of three modes:

1. durable queued and retryable;
2. online-only with an explicit disabled/offline state;
3. ephemeral and intentionally disposable.

Silent accidental mode selection is prohibited.

- Retryable mutations **MUST** be persisted before optimistic acknowledgement.
- A logical action keeps one idempotency key across transport retries, revision
  conflicts, app restarts, and background execution.
- Optimistic patches have deterministic commit and rollback reducers.
- Dependencies are explicit: a message cannot dispatch before its attachment
  jobs succeed; a dependent edit cannot overtake message creation.
- Terminal failure remains visible and actionable. No infinite spinner, hidden
  rejection, or automatic disappearance of user work.
- Duplicate taps, HTTP responses, realtime echoes, and replayed cache entries
  converge to one outcome.

## 7. Messaging and realtime

- A stream sequence defines message order. Client timestamps never reorder
  durable messages.
- `clientId` identifies one logical send and remains stable until reconciliation.
- Realtime handlers validate payloads and dispatch domain events; they do not
  contain UI or persistence policy.
- Reconnect resumes from a durable cursor. If replay is unavailable, the client
  performs a bounded delta/reconciliation without clearing usable cached state.
- Bootstrap invalidation is a fallback. Routine message, attachment, activity,
  read, and conversation updates use narrow typed domain events.
- Typing and drawing previews are explicitly ephemeral, bounded, throttled, and
  never the only copy of a completed result.
- Read state represents a durable remote cursor. UI checks cannot be inferred
  solely from local submission.

## 8. Attachments and media

An attachment is a normalized durable entity. Messages and activities reference
attachment IDs; they do not own independent mutable copies.

The lifecycle is explicit:

```text
selected -> staged -> uploading -> uploaded -> processing -> ready
                                                |             |
                                                +-> failed <-+
```

- Every transition is monotonic or an explicit retry transition.
- Upload completion and media processing completion are separate states.
- Media-worker completion/failure **MUST** publish a durable recipient-scoped
  attachment event. Open clients update without reopening a chat.
- Original blobs are immutable. Derivatives are versioned and atomically linked.
- UI reserves geometry from validated metadata, uses a bounded safe fallback,
  and never instantiates a decoder merely to measure a list row.
- Images use native memory/disk caching; playback components are created only
  on demand and released when no longer active.
- Voice playback has one coordinator, one active item, recoverable load/error
  states, audio-focus handling, and no high-frequency global-store updates.
- One invalid image, video, waveform, or activity derivative is isolated to one
  content subtree.
- Compression and metadata stripping are centralized policies with golden-file
  tests. HQ/original bypasses are explicit.

## 9. Transfers

Transfers are independent durable jobs keyed by transfer and batch IDs. A
single global `activeUpload` or `uploadProgress` is prohibited.

- Each job owns account, source, destination, byte offset, checksum, capability,
  state, progress, retry count, and cancellation state.
- UI subscribes only to the jobs it started or displays.
- Multiple chats and activities may prepare transfers concurrently within a
  bounded scheduler.
- WorkManager is authoritative for scheduled Android background work. JavaScript
  reconciles durable native results and dispatches messages idempotently.
- Process death, reboot, connectivity loss, token rotation, navigation, and
  cancellation are mandatory behavioral tests.
- Progress is monotonic per attempt and never interpreted as success before
  server commit and checksum verification.

## 10. Calls

- Call lifecycle, notification lifecycle, and LiveKit media lifecycle are
  separate state machines joined by the exact durable call ID.
- Tokens never create rooms and never outlive their authorized call state.
- UI exposes connecting, connected, reconnecting, degraded, and terminal states
  honestly. A timeout is recoverable and never an endless loader.
- Audio route, microphone permission, foreground service, and LiveKit track
  publication are verified independently in diagnostics.
- Call state updates do not subscribe or rerender message lists.
- Release evidence requires two physical devices on independent networks plus a
  forced TURN/TLS path. Signaling-only checks are insufficient.

## 11. Backend jobs

- Long-lived delivery and processing jobs run outside the request-serving API
  process unless a documented single-process exception exists.
- Durable PostgreSQL queues use leases, `SKIP LOCKED`, heartbeats, bounded
  attempts, exponential backoff, terminal states, and abandoned-claim recovery.
- A worker crash cannot leave an item permanently running.
- Every job is idempotent and safe to execute after an ambiguous commit.
- Polling has a bounded interval and batch size; PostgreSQL `NOTIFY` may reduce
  latency but is never the durable queue.
- Expensive media work respects concurrency, CPU, memory, input, output, and
  wall-clock limits.

## 12. UI, navigation, and failure isolation

- Navigation acknowledges within one frame and never waits for network work.
- Cached content remains visible during reconciliation.
- Inactive heavy tab trees are frozen or unmounted; hidden screens do not retain
  expensive subscriptions or run effects merely to make a future tap appear fast.
- Store/view-model subscriptions select the smallest stable value. High-frequency
  progress, waveform, drawing, and call statistics never invalidate a chat list.
- Virtualized message rows are memoized and stable by durable ID.
- Every independently renderable user-data subtree has a local recovery boundary.
  A route-level boundary is the last resort, not routine error handling.
- Keyboard motion follows the native/UI-thread animation. Safe-area insets and
  focused controls remain visible with gesture and three-button navigation.
- Accessibility roles, labels, state, focus order, font scaling, and minimum
  targets are release requirements. Color alone never conveys state.
- Design behavior follows `DESIGN.md`; decorative work cannot consume a
  performance or readability budget.

## 13. State and module size

- A global store may hold session/shell coordination, but domain entities,
  repositories, mutations, and transfer state live in domain modules.
- New functionality **MUST NOT** be added to a known monolith while its target
  domain module exists.
- Files above 500 lines, React components above 300 lines, or components with
  more than 12 store subscriptions require decomposition or a written review
  exception. Generated tables and localized copy are excluded.
- Boolean combinations that encode a lifecycle are replaced with a discriminated
  union/state machine.
- Module-level mutable state is allowed only inside an explicitly owned service
  with reset/dispose behavior and tests.

## 14. Capabilities and dormant products

- Dormant features remain preserved in server schema/code but are excluded from
  current bootstrap projections, mobile navigation, background work, and bundles
  where practical.
- Runtime capabilities are server-signed/versioned, cached with safe defaults,
  and fail closed for optional features.
- A remote kill switch may disable calls, activities, or uploads, but cannot
  delete cached data or strand an in-progress durable operation.
- Capability changes are observable and covered by compatibility tests for old
  clients.

## 15. Observability

- Every important journey records bounded phase timings and a correlation ID:
  startup, chat open, send, upload, processing, playback, call join, reconnect,
  notification, and update.
- Native crashes and ANRs are aggregated by app version, device, Android version,
  and top sanitized frame. Message contents, tokens, emails, and private URLs are
  never collected.
- Expected failures are metrics, not noisy exceptions. Unexpected failures retain
  enough sanitized structure to reproduce the failing subsystem.
- Health means user-visible capability, not merely a running process. Queue age,
  failed jobs, push receipts, media completion latency, and call media path are
  monitored.

## 16. Tests and release evidence

Every behavior change includes the lowest useful deterministic test and the
highest necessary integration test.

Validation is incremental. During implementation, run changed-workspace
typechecks and focused behavioral tests; do not repeatedly run the complete
monorepo or release matrix. A signed Android tester candidate follows the
reduced, risk-based lane in `DEVELOPMENT_WORKFLOW.md`: it keeps mandatory
signing, provenance, package, legal-evidence, updater, hash, and atomic
publication checks, while unrelated suites and the full physical-device matrix
wait for stable promotion. Production server/data changes always retain the
full applicable gate.

- Source-text/regex assertions may guard a build invariant but never count as
  behavioral coverage.
- Contract tests validate both accepted and rejected payloads.
- Repository tests cover stale/new ordering, duplicate delivery, process restart,
  account switching, malformed records, and transaction failure.
- API tests execute real migrations and PostgreSQL constraints.
- Android E2E uses stable `testID`/accessibility selectors and a signed release
  build. Sleep-based synchronization is prohibited when an observable state is
  available.
- Media tests include real representative files, corrupt/truncated files,
  orientation, extreme dimensions, silence, and range/auth behavior.
- Physical Samsung A12 evidence is mandatory for native media, keyboard, list,
  call, and performance claims.

A release cannot be called complete while required physical evidence is absent.
It may be published as a tester candidate with the exact unverified journeys
listed. A tester candidate is intentionally outside the definition of done; its
purpose is to collect fast, honest evidence rather than simulate final release
confidence with unrelated tests.

## 17. Rewrite and migration discipline

The rewrite is an incremental replacement, not a second permanent application.

1. Characterize current behavior with tests and production-compatible fixtures.
2. Introduce one new boundary behind the existing public interface.
3. Migrate one complete vertical journey.
4. Prove old/new compatibility, retries, process death, and rollback.
5. Remove the replaced path in the same stage or record a dated removal gate.
6. Continue only with a clean diff and passing relevant suites.

Do not combine schema migration, architectural movement, visual redesign, and
unrelated feature work in one unreviewable change. Never reset, clean, stage, or
modify the legacy root tree.

## 18. Definition of done

A change is done only when:

- ownership and dependency direction are unambiguous;
- runtime inputs are validated;
- durable/optimistic/realtime/cache states converge under duplicate and reordered
  delivery;
- cancellation, offline, retry, process death, malformed input, and terminal
  failure states are handled;
- user work stays visible and recoverable;
- relevant behavioral, integration, native, and physical tests pass;
- performance budgets do not regress;
- diagnostics are useful and privacy-safe;
- migrations, rollback, operations, and documentation are updated;
- the final diff contains no superseded compatibility path without an explicit
  removal gate.
