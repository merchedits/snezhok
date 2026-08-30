# End-to-end encryption is a protocol migration, not a UI toggle

- Status: Accepted
- Date: 2026-08-30
- Owner: Snezhok engineering
- Supersedes: none

## Context and outcome

Snezhok's current chats are server-readable. TLS protects transport, Android
protects credentials with SecureStore, and production backups are encrypted,
but the API, PostgreSQL, media worker, notification pipeline, and operator can
access message or attachment plaintext. Calling this E2EE would be false.

The goal is to establish the minimum safe program for a future E2EE mode
without inventing cryptography inside an ordinary feature batch.

## Evidence

- Signal's specifications separate key agreement, Double Ratchet sessions, and
  Sesame multi-device management; this is much larger than encrypting a field.
- Signal's maintained `libsignal` exposes protocol primitives but says use
  outside Signal is unsupported. It is a candidate, not an automatic choice.
- Matrix/Element demonstrates the group-session, device trust, key sharing,
  backup, verification, and history trade-offs of multi-device encrypted rooms.
- Snezhok currently depends on server-readable content for search, previews,
  moderation, media processing, deduplication, recovery, and device history.

References:

- [Signal protocol specifications](https://signal.org/docs/)
- [Signal libsignal repository](https://github.com/signalapp/libsignal)
- [Matrix E2EE guide](https://matrix.org/docs/matrix-concepts/end-to-end-encryption/)
- [OWASP cryptographic storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)

## Options

| Option | Correctness and UX | Compatibility | Risk |
| --- | --- | --- | --- |
| Label TLS chats encrypted | Incorrect and misleading | No cost | Rejected security claim |
| Add custom field encryption | Misses identity, ratchets, replay, groups, files and recovery | Superficially small | Catastrophic protocol risk |
| Build reviewed E2EE on established primitives | Can provide a truthful boundary | Staged migration required | Only acceptable direction |

## Decision

Keep current chats explicitly server-readable. Do not ship custom cryptography
or an E2EE label. A future encrypted-chat program must cover:

1. per-device identity, signed prekeys, auditable device lists, verification,
   revocation, rotation, and compromise recovery;
2. one-to-one ratchets and a separately justified group protocol;
3. attachment keys, authenticated chunk encryption, thumbnails, voice, calls,
   and key envelopes independent of upload capabilities;
4. multi-device history, encrypted backup, lost-device recovery, and expiry;
5. notification, search, moderation, reporting, preview, deduplication, and
   media-processing behavior when the server cannot read content;
6. versioning, mixed clients, migration, rollback, test vectors, fuzzing, and
   external review.

No encrypted room may silently downgrade. Server-readable and E2EE rooms must
have distinct durable policy and unmistakable user-facing state.

## Consequences and rollback

Current behavior remains compatible and honest. Snezhok does not yet protect
content from a compromised/operator-equivalent server. This record can be
superseded only by a reviewed protocol and migration with independent evidence.

## Validation

- Current UI/docs must not make an E2EE claim for standard chats.
- Threat-model review and published test vectors are prerequisites to code.
- Cross-device, revocation, replay, reordering, restore, lost-key, attachment,
  and mixed-version matrices are mandatory before any tester room.
- External cryptographic review is mandatory before stable promotion.
