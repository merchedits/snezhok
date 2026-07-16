# Production operations

This runbook covers encrypted backups, restore drills, storage retention, and recovery boundaries. It deliberately does not claim end-to-end encryption: Snezhok's server can read messages and media. These controls protect recovery artifacts at rest and make data loss detectable.

## Recovery objectives

- Back up PostgreSQL and immutable media as one synchronized recovery point every day.
- Keep at least 14 recovery points and at least 30 days, deleting only backups that passed a real isolated restore.
- Perform an isolated PostgreSQL restore and database-to-media reference check every week.
- Store the backup directory on a different physical disk or an off-host encrypted mount. A directory on the application disk is not a disaster-recovery backup.
- Keep a second offline copy of the age identity and the Android signing key. Never store either private key inside a backup directory.

## One-time setup

Install `age`, `zstd`, Docker Compose, and GNU coreutils. Create the age identity with a restrictive umask:

```bash
sudo install -d -m 0700 -o merchedits -g merchedits /etc/snezhok
sudo -u merchedits sh -c 'umask 077; age-keygen -o /etc/snezhok/backup-age-identity.txt'
sudo -u merchedits age-keygen -y /etc/snezhok/backup-age-identity.txt \
  | sudo -u merchedits tee /etc/snezhok/backup-age-recipient.txt >/dev/null
sudo chmod 0600 /etc/snezhok/backup-age-identity.txt
sudo chmod 0644 /etc/snezhok/backup-age-recipient.txt
```

Copy the private identity to offline encrypted custody and verify that it can decrypt a test artifact. The automated verifier needs a local identity; if a threat model forbids that, disable its timer and perform the weekly verification from a separate recovery host.

Mount the backup target at `/var/backups/snezhok`, owned by `merchedits`, then install the environment and unit templates:

```bash
sudo install -m 0644 infra/systemd/snezhok-{backup,restore-verify,retention}.{service,timer} /etc/systemd/system/
sudo install -m 0644 infra/systemd/maintenance.env.example /etc/snezhok/maintenance.env
sudo chmod 0755 scripts/maintenance/*.sh scripts/livekit/*.sh
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/snezhok-{backup,restore-verify,retention}.{service,timer}
sudo systemctl enable --now snezhok-backup.timer snezhok-restore-verify.timer snezhok-retention.timer
```

Adjust paths in copied unit files if the checkout or backup mount differs. `RequiresMountsFor` plus the script's explicit mountpoint check prevents silently writing backups to the underlying system disk when a backup mount is absent. Systemd creates `/var/lib/snezhok-maintenance` as the shared persistent lock directory, so concurrent backup, restore-verification, and retention jobs cannot race on a first install.

## Backup safety model

[`create-backup.sh`](../scripts/maintenance/create-backup.sh) does the following:

1. checks free space for the logical database and media sizes plus reserve, the age recipient, media layout, and an exclusive maintenance lock;
2. records which write services are currently running and briefly stops only the API and media worker;
3. streams a PostgreSQL custom dump directly into age—no plaintext database dump reaches disk;
4. hard-links the immutable generation-keyed object tree to capture directory membership;
5. restores the services immediately, then streams media through zstd and age;
6. writes checksums and a non-secret manifest, fsyncs them, and atomically renames the completed directory;
7. prunes only old backups that carry both `.complete` and `.verified` markers.

Interrupted backups remain under `.incomplete-*`, never receive `.complete`, and are rejected by restore tooling. A trap attempts to restore every service that was running before maintenance.

Start and inspect the first recovery point:

```bash
sudo systemctl start snezhok-backup.service
sudo journalctl -u snezhok-backup.service --since today
sudo systemctl start snezhok-restore-verify.service
sudo journalctl -u snezhok-restore-verify.service --since today
```

The restore verifier refuses plaintext payloads, validates the encrypted-file hashes, authenticates both age streams, restores PostgreSQL into a network-isolated disposable PostgreSQL 17 container, checks table/index health, and proves that every `blobs.storage_key` exists in the authenticated media archive. `.verified` binds the successful drill to the checksum manifest.

## Production recovery

Never improvise a partial restore. A database and media archive from different backup directories are inconsistent.

1. Isolate the incident and preserve the current database volume and media tree; do not delete them.
2. Select a directory containing `.complete`, encrypted `*.age` payloads, and `.verified`.
3. Re-run `verify-backup-restore.sh /absolute/path/to/backup` with the identity from offline custody.
4. Confirm that `.verified` contains the current SHA-256 of `SHA256SUMS`. Any mismatch requires another full verification.
5. Stop `app` and `media-worker`. Restore into a new PostgreSQL database and a new media directory, never over the live targets.
6. Check counts, log in through an isolated application instance, open several old attachments, and run migrations against the restored copy.
7. Atomically switch both recovery units during one maintenance window. Retain the former database volume and object directory until the restored system has passed acceptance tests.

Temporary, incomplete upload chunks are intentionally excluded: they are not user-visible durable data and copying a multi-gigabyte partial upload would extend the write outage. Before starting an application against a restored database, invalidate those resumable sessions with `UPDATE upload_sessions SET status='failed', updated_at=now() WHERE status IN ('uploading','finalizing');`. Clients can restart the affected upload; finalized attachment objects remain protected.

The repository intentionally does not include a one-command destructive production restore. The verified preparation is automated; changing live recovery units remains an explicit operator action with a preserved rollback point.

## Storage and release retention

`prune-storage.sh` is dry-run by default. With `--apply`, it records running services, quiesces writers, refreshes database references, and deletes only:

- immutable objects older than seven days whose exact storage key has no `blobs` row;
- temporary uploads older than two days that are not a live, unexpired upload session.

Unexpected paths and symbolic layouts are skipped. `prune-releases.mjs` preserves `snezhok-current.apk`, its manifest's version, the five newest versioned APK/manifest pairs, and every artifact newer than 30 days. Incomplete pairs are retained for manual inspection.

Run both without `--apply` after every schema or storage-layout change. Alert on timer failure with the host's existing monitoring; systemd logs alone are not an alerting system.
