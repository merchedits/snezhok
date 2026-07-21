# Global administration

Snezhok exposes global administration only to authenticated accounts whose live `users.is_admin` value is true. The mobile entry is omitted for every other account, and every `/api/v1/admin/*` endpoint independently enforces the same boundary. UI visibility is never treated as authorization.

Public registration never grants administration from a username, registration
order, or email address. After the intended operator has registered, obtain that
existing account's UUID from the server console and run the audited one-shot
bootstrap explicitly:

```bash
docker compose --file docker-compose.production.yml run --rm \
  -e ADMIN_BOOTSTRAP_USER_ID=00000000-0000-4000-8000-000000000000 \
  migrate node apps/api/dist/commands/bootstrap-admin.js
```

The command uses the migration-owner connection, refuses deleted/nonexistent
accounts, serializes with other administrator changes, and writes
`administrator.bootstrapped` to the global audit log. Never expose this command
as an HTTP endpoint or put the target ID in the public registration path.

## Policies

The singleton `global_admin_settings` row defines:

- the default ability to create servers, create group chats, upload files, and start new calls;
- the default logical storage quota per member and maximum accepted source-file size;
- optional message retention plus orphaned-media and sync-event retention.

Per-member rows contain only explicit overrides. Leaving an override unset means later global changes continue to apply. Global administrators always receive all four abilities. Storage usage charges source attachments owned by the account; server-generated thumbnails and transcodes are operational overhead and are not charged again.

Upload initialization takes a per-account PostgreSQL advisory lock and reserves active upload sizes alongside completed attachment usage. This prevents parallel initializations from exceeding a quota. The compiled server transport limit remains an upper bound even if an operator attempts to configure a larger file limit.

## Safe changes

Global settings use an incrementing revision. A stale client receives `409 CONFLICT`, reloads the current values, and must explicitly retry. Member mutations and administrator-count checks run in one transaction under a global advisory lock. An administrator cannot demote or suspend their own account, and the API never permits removal of the last active administrator.

Suspension immediately revokes every active device session. Unsuspending an account does not restore those credentials; the member must sign in again. Promotion and demotion are evaluated from the database on every authenticated request, so an old access token cannot preserve removed privileges. Account deletion is rejected for the final active administrator until access is handed to another active account.

## Retention

Message retention is disabled when its value is `null`. When enabled, the bounded reliability-maintenance job permanently deletes messages older than the configured number of days. Sync events are retained for no longer than the message window, preventing message payloads from outliving retained messages. Orphaned media remains protected while referenced by messages, profiles, server/group images, scheduled messages, derivatives, or active processing jobs.

Retention is destructive and should be changed only after a verified backup. Maintenance is batched, so a policy change converges over successive runs rather than issuing one unbounded database delete.

## Audit trail

Every global settings or member-policy mutation writes a metadata-only entry to `global_admin_audit_log`. Audit records contain the actor, target, action, changed field names, and timestamp; they do not record passwords, tokens, message text, or uploaded content.
