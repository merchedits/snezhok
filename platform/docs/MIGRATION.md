# Legacy Migration

The production SQLite database is never modified in place. Migration is one-way, repeatable and performed against a fresh PostgreSQL database.

## Mapping

- Preserve user IDs, usernames, display names, avatars, profile text, administration state and creation timestamps.
- Preserve bcrypt hashes with an algorithm marker and upgrade them to Argon2id on the next successful login.
- Do not copy active sessions; every device signs in again.
- Create a private default server and map the legacy global conversation to its `#general` text channel.
- Import valid two-person conversations as direct chats.
- Import a single-member direct conversation as Saved Messages.
- Import group conversations as private groups.
- Preserve message timestamps, reply relationships, edits, pins and reactions.
- Reconcile database file records with physical objects by checksum. Unlinked files go into an owner-specific recovery report rather than being deleted.
- Convert read timestamps to the greatest imported sequence at or before that time.
- Preserve pending friend requests, friendships, mute state and invite codes where records are valid.

## Cutover

1. Back up the complete legacy volume and current image.
2. Deploy v3 on port 3003 with its own database and media directory.
3. Run migrations and an initial import while the legacy app remains online.
4. Exercise both clients against staging and verify counts, hashes and authorization.
5. Briefly stop message writes, checkpoint SQLite and take a final backup.
6. Reset the fresh v3 database and rerun the idempotent importer from the final snapshot.
7. Compare the generated migration report with source counts.
8. Switch only the `/chat/` Nginx upstream from port 3002 to 3003.
9. Keep the old container and data volume untouched until acceptance.

Rollback changes the upstream back to port 3002. The legacy database is not downgraded from PostgreSQL and receives no v3 writes.

## Required verification

- Source and destination account counts.
- Message counts per source conversation and destination stream.
- Reply and reaction referential integrity.
- Every attached file checksum, size and authorization owner.
- Orphan/recovery manifest review.
- Login with each imported hash algorithm.
- Bootstrap authorization for every imported chat and server.
- Random message sampling at the beginning, middle and end of each stream.
