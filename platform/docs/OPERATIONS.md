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

Mount the backup target at `/var/backups/snezhok`, owned by `merchedits`, then
install the protected environment and unit templates. The installer requires
the exact public source revision, installs recovery dependencies, writes the
environment as root-owned mode `0600`, verifies every unit, and leaves timers
disabled for inspection unless `--enable` is explicit:

```bash
sudo SNEZHOK_SOURCE_REVISION="$SOURCE_REVISION" \
  bash scripts/deploy/install-maintenance.sh "$SOURCE_REVISION"
sudoedit /etc/snezhok/maintenance.env
sudo SNEZHOK_SOURCE_REVISION="$SOURCE_REVISION" \
  bash scripts/deploy/install-maintenance.sh "$SOURCE_REVISION" --enable
```

Set `SNEZHOK_ALERT_WEBHOOK_URL` to an operator-controlled receiver before
enabling timers. A webhook URL can contain a credential and must never be put in
a world-readable environment file. Re-run the installer with the new exact
revision on every deployment. Adjust the unit templates first if the checkout
path differs from `/home/merchedits/sites/snezhok-v3/platform`.

`RequiresMountsFor` plus the scripts' explicit mountpoint check prevents
silently writing backups to the underlying system disk when a backup mount is
absent. Systemd creates `/var/lib/snezhok-maintenance` as the shared persistent
lock directory, so concurrent backup, restore-verification, mirror, and
retention jobs cannot race on a first install.

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

## Point-in-time recovery

The production PostgreSQL image continuously archives completed WAL segments
with `age` to the recovery disk and forces a segment switch at least every five
minutes. `snezhok-pitr-base.timer` creates and decrypt-verifies a weekly physical
base backup. `snezhok-pitr-restore-verify.timer` forces a deterministic WAL
boundary, authenticates every archived file required after the selected base,
performs an isolated networkless recovery through that target LSN, promotes the
database, checks tables/indexes, and erases plaintext before publishing its
marker. `snezhok-media-mirror.timer` independently encrypts every immutable
media object to the recovery disk within ten minutes. Encrypted bases and WAL
are retained for 45 days. Removed media is retained for at least 52 days
starting when disappearance is first observed, not from the object's original
mirror timestamp. The extra weekly interval prevents the oldest retained
database recovery point from outliving one of its immutable objects. This reduces the practical RPO
to approximately ten minutes when the recovery disk is healthy.

For PITR, copy the selected encrypted base and WAL range to an isolated recovery
host, decrypt with the offline identity, and configure PostgreSQL
`restore_command` to decrypt `%f.age` into `%p`. Set `recovery_target_time` (or
LSN), start the isolated database, and validate application counts and media
references before any production switch. Never mount the age private identity
inside the live PostgreSQL container; it receives only the public recipient.

## Production recovery

Never improvise a partial restore. A database and media archive from different backup directories are inconsistent.

1. Isolate the incident and preserve the current database volume and media tree; do not delete them.
2. Select a directory containing `.complete`, encrypted `*.age` payloads, and `.verified`.
3. Re-run `verify-backup-restore.sh /absolute/path/to/backup` with the identity from offline custody.
4. Confirm that `.verified` contains the current SHA-256 of `SHA256SUMS`. Any mismatch requires another full verification.
5. Stop `app`, `job-worker`, and `media-worker`. Restore into a new PostgreSQL database and a new media directory, never over the live targets. The job worker is a database writer and must never run during a restore.
6. Check counts, log in through an isolated application instance, open several old attachments, and run migrations against the restored copy.
7. Atomically switch both recovery units during one maintenance window. Retain the former database volume and object directory until the restored system has passed acceptance tests.

Temporary, incomplete upload chunks are intentionally excluded: they are not user-visible durable data and copying a multi-gigabyte partial upload would extend the write outage. Before starting an application against a restored database, invalidate those resumable sessions with `UPDATE upload_sessions SET status='failed', updated_at=now() WHERE status IN ('uploading','receiving','finalizing');`. Clients can restart the affected upload; finalized attachment objects remain protected.

The repository intentionally does not include a one-command destructive production restore. The verified preparation is automated; changing live recovery units remains an explicit operator action with a preserved rollback point.

## Messaging integrity audit

After message/media schema changes and during post-deployment acceptance, run
the privacy-safe aggregate audit inside the application runtime:

```bash
npm run messaging:audit --workspace=@snezhok/api
```

It prints counts only. Invalid message/attachment shapes, ready attachments
without blob metadata, or attachment/blob byte mismatches fail the command.
Failed linked media, stale processing attachments, and stale media jobs are
reported as operational signals for investigation because historical failures
can legitimately remain after a user-visible retry. The command never prints
message content, user identifiers, filenames, URLs, or storage keys.

## Storage and release retention

`prune-storage.sh` is dry-run by default. With `--apply`, it records running services, quiesces writers, refreshes database references, and deletes only:

- immutable objects older than seven days whose exact storage key has no `blobs` row;
- temporary uploads older than two days that are not a live, unexpired upload session.

Unexpected paths and symbolic layouts are skipped. Backup retention always
protects the newest 14 complete daily points and every protected restore-proven
point. Once two restore drills exist, older unverified complete points are
bounded after 35 days and interrupted `.incomplete-*` directories after seven
days. The monitor alerts before either backlog exceeds its cleanup window.
`prune-releases.mjs` preserves `snezhok-current.apk`, its manifest's version,
the five newest versioned APK/manifest pairs, and every artifact newer than 30
days. Incomplete release pairs are retained for manual inspection.

Run both without `--apply` after every schema or storage-layout change. Alert on timer failure with the host's existing monitoring; systemd logs alone are not an alerting system.

## External health alerting

`snezhok-monitor.timer` checks API/database readiness, all writer containers,
LiveKit signaling through the local TLS ingress, application-disk pressure, the
off-host backup mount, and the age of the newest restore-verified recovery
point. Production acceptance also requires an off-host encrypted recovery copy,
an offline age identity, and a test alert delivered independently of this host.
Configure `SNEZHOK_ALERT_WEBHOOK_URL` in `/etc/snezhok/maintenance.env`
to deliver failures to an operator-controlled alert receiver. The check writes
only a compact non-secret status to `/var/lib/snezhok-maintenance`; it never
includes credentials, message content, account identifiers, or request logs.

The production host deliberately does not run the public ICE/TURN probe by
default: a home router without NAT hairpin would turn a healthy deployment into
a permanent false alarm. Run this from an independent network and schedule it
there with the same private alert receiver:

```bash
SNEZHOK_ALERT_WEBHOOK_URL="$ALERT_WEBHOOK" \
  bash scripts/monitoring/external-connectivity.sh --timeout 8
```

The public listener smoke test cannot prove authenticated TURN allocation or
media flow. Keep the documented two-device, different-network and UDP-blocked
call acceptance run as a release gate.

The regular health monitor also fails when the durable push outbox is older
than `SNEZHOK_MAX_PUSH_QUEUE_AGE_SECONDS` (900 by default) or when a push outbox
enters the failed state in the previous hour. This observes application-side
delivery attempts and Expo receipts without exposing device tokens. A healthy
queue still does not prove FCM credentials or killed-app delivery; verify those
with the signed APK on a physical device.

Client crash/ANR reports are not raw telemetry storage. `/api/v1/diagnostics/
client-reports` validates the shared contract, strips non-allowlisted messages
and context keys, deduplicates stable event IDs, and increments daily
aggregates. An administrator can inspect the bounded last 1–30 days through
`GET /api/v1/diagnostics/aggregates?days=7`; diagnostic health exposes the
warning/error occurrence count for the last 24 hours. Reliability maintenance
deletes event hashes and aggregates older than 90 days. A count identifies a
regression signal, not proof that a journey is healthy; reproduce on the signed
APK and retain physical-device evidence.

## Optional off-host encrypted replication

The dedicated recovery disk protects against application-disk failure but not
theft, fire, administrator error, or complete host compromise. Configure an
independent rclone destination outside the repository, keep its credentials in
`/etc/snezhok/rclone.conf` as `merchedits`-owned mode `0600`, and test it manually:

```bash
# install-maintenance.sh installs rclone; configure its private credential file.
sudo -u merchedits env \
  SNEZHOK_OFFSITE_REMOTE='private-remote:snezhok-production' \
  SNEZHOK_RCLONE_CONFIG=/etc/snezhok/rclone.conf \
  bash scripts/maintenance/replicate-encrypted-backups.sh
```

The replicator includes encrypted payloads, fixed checksums/manifests, atomic
completion markers, and the small restore-verification markers. Immutable data
is copied with overwrite protection and checked before each daily completion
marker is published; mutable verification evidence is updated in a separate
bounded pass. Disappearance tombstones remain host-side. It runs `rclone check`
before publishing a local freshness marker. It never deletes remote recovery
data. After the real remote has passed a recovery-host download
and decrypt test, put `SNEZHOK_OFFSITE_REMOTE` in the protected maintenance
environment, set `SNEZHOK_REQUIRE_OFFSITE_BACKUP=1`, and enable the optional
timer:

```bash
sudo systemctl enable --now snezhok-offsite-backup.timer
```

The installer deliberately never enables this timer: an empty or untested
remote is a release blocker, not a placeholder that can be treated as backup.
