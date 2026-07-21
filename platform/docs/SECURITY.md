# Security and privacy model

Snezhok is a private, server-authoritative cloud messenger. Standard chats are
**not end-to-end encrypted**. TLS protects traffic in transit, Android keeps
session tokens in platform-protected secure storage, and production backups are
encrypted before leaving the application host. The server operator and anyone
who gains equivalent database/storage access can read message and attachment
content. The UI and documentation must never label these chats as E2EE.

This is an intentional boundary for the current small private deployment:
server-side search, attachment deduplication and transcoding, multi-device
history, moderation, notification previews, and account recovery all depend on
server-readable content. Adding E2EE later requires a separately reviewed
protocol with device identity keys, verified device lists, sender keys for
groups, key rotation, encrypted search trade-offs, attachment key envelopes,
and a migration plan. Reusing transport TLS or inventing application crypto is
not an acceptable substitute.

## Trust boundaries

- PostgreSQL is authoritative for accounts, membership, messages, read state,
  permissions, sessions, transfers, and durable realtime cursors.
- Blob objects are immutable. Access always passes through an authenticated
  authorization query; Nginx receives only an internal redirect after approval.
- LiveKit receives short-lived, room-scoped grants after the API verifies stream
  membership. API and LiveKit secrets never enter client bundles.
- Android access and refresh tokens live in SecureStore. The bounded SQLite
  message cache and downloaded media rely on Android application sandboxing and
  device encryption; users of a rooted or unlocked device should assume local
  content is recoverable.
- Diagnostic reports exclude credentials, email addresses, account IDs,
  message text, exception messages, and stack payloads that may contain user
  content.

## Required production controls

- Use unique secrets for JWT signing, LiveKit, PostgreSQL, backup encryption,
  and Android release signing. Never commit them or print them in CI logs.
- Keep the backup age identity offline and separate from the encrypted backup
  target. A backup stored beside its only decryption key is not protected.
- Restrict SSH, database, storage, and deployment access to named operators;
  review server audit events and active device sessions regularly.
- Terminate HTTPS with a trusted certificate, retain strict origin and request
  validation, and forward only the documented media and TURN ports.
- Treat notification previews as plaintext disclosed to the push provider and
  lock screen. Users can disable previews globally or per stream.
- Run dependency, migration, restore, artifact-signature, and attachment
  authorization gates for every release.
- Run `npm run compliance:check` before review. CI keeps the committed-secret
  scanner redacted, emits CycloneDX/license evidence, verifies public GPL source
  reachability on pushed release builds, and blocks fixable high/critical
  container vulnerabilities. A reported secret must be revoked before it is
  removed from history; deleting the line alone is not incident response.

## Deletion and retention

Deleting for oneself creates a recipient-specific hide record. Deleting for
everyone creates a durable tombstone and detaches media after the configured
grace period. Account deletion revokes sessions, disables push devices, removes
social links and private profile data, and retains an anonymized message author
so other participants' history remains internally consistent. Immutable blobs
are reclaimed only when no attachment or derivative references them and their
generation-specific key is past the retention grace period.

Operational retention values, encrypted backup handling, recovery drills, and
incident commands are documented in [OPERATIONS.md](./OPERATIONS.md).
