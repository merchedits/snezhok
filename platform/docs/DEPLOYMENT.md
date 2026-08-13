# Production Deployment

## Prerequisites

- Docker Engine and Compose.
- Nginx with a trusted certificate for `merchedits.xyz`.
- TCP 7881, UDP 7882 and UDP 3478 allowed by UFW and forwarded by the router to `192.168.2.11`.
- A backed-up Android release signing keystore.
- An Expo/EAS project and matching Firebase FCM V1 credential for killed-app Android notifications.
- Strong random values for PostgreSQL, sessions and LiveKit credentials.

## Staged topology

The legacy app remains on `127.0.0.1:3002`. Snezhok v3 binds to `127.0.0.1:3003` until cutover. LiveKit signaling binds to host port 7880 and is exposed through the existing HTTPS virtual host at `/chat/livekit/`.

The `snezhok_v3_postgres` volume and `platform/data-v3/storage` media directory are separate recovery units. Both must be backed up together before releases that change the schema or media layout.

Daily age-encrypted synchronized backups, isolated weekly restore drills, and retention are defined in [OPERATIONS.md](./OPERATIONS.md). A local database dump without its matching media archive is not a valid recovery point.

## Release gate

1. Install from the lockfiles.
2. Run contract, API, web and Android type checks and tests.
3. Build the web/server production image and signed APK.
   CI runs the native Kotlin background-transfer unit tests and compiles the
   macrobenchmark APK. It cannot generate representative baseline-profile or
   frame-timing evidence: the inbox/chat/media scenarios require an
   authenticated physical device with private test data. Run the signed APK on
   the Samsung A12 according to `apps/mobile/performance/A12_BUDGETS.md`; retain
   the benchmark output and generated profile as release evidence.
4. Run SQL migrations in a one-shot deployment task.
5. Start PostgreSQL, the app and LiveKit without changing Nginx.
6. Verify app, PostgreSQL and LiveKit health; inspect logs and resource limits.
   For production call fallback, follow [CALL_CONNECTIVITY.md](./CALL_CONNECTIVITY.md) and pass its external STUN/TLS smoke test plus a real two-device relayed call.
7. Exercise registration/login, bootstrap, send/retry, uploads/ranges, realtime resume, calls and screen share.
   Verify a message, incoming call, decline and missed call with the APK process terminated. A build without `EXPO_PUBLIC_EAS_PROJECT_ID`, `GOOGLE_SERVICES_JSON` and the EAS FCM V1 credential cannot pass this gate.
8. Run the final data migration and count/hash report.
9. Validate Nginx configuration, switch the `/chat/` upstream to port 3003 and reload.
10. Verify the public web app and APK against production.

The production host uses exact 40-character public revisions. Install the
maintenance services once with the revision that is currently running. After
the source tree and protected `.env` have been updated so `IMAGE_TAG` equals
the new public revision, run the guarded deployment helper:

```bash
# One-time bootstrap only; CURRENT_REVISION is read from the live health route.
sudo bash scripts/deploy/install-maintenance.sh "$CURRENT_REVISION" --enable

sudo bash scripts/deploy/deploy-production.sh "$SOURCE_REVISION"
```

The deployment helper refuses a permissive `.env`, creates a synchronized
encrypted recovery point, builds all three revision-labelled images, runs the
one-shot migration and role provisioning, waits for health, verifies OCI and
API revision provenance through local TLS, verifies that every PostgreSQL blob
reference resolves to an immutable object with the expected byte count (and is
readable by Nginx when running as root), and checks the Android channel's range
response. The pre-deployment backup is deliberately labelled with the
still-running revision; only after the new release passes verification does the
helper update the maintenance environment and units to the new revision. It
also refuses a dirty checkout or a revision that is not reachable from the
public GPL source repository. It does not synchronize source files or modify
`.env`; those remain explicit reviewed deployment inputs.

## Rollback

Nginx can be switched back to port 3002 without modifying legacy data. Restore v3 PostgreSQL and media from the same backup point when a v3 rollback is required. Never restore only one side of the database/media pair.

Authenticated attachments use `X-Accel-Redirect`: the API authorizes each
request, then Nginx reads the immutable object. The canonical checkout remains
private, while `deploy-production.sh` installs an execute-only ACL for
`www-data` on `/home/merchedits/sites/snezhok-v3` and verifies traversal to the
object directory. It also checks all database-referenced media before creating
the deployment recovery point and after the new containers become healthy. A missing ACL presents as successful API file lookups followed
by public HTTP 403 responses and `Permission denied` entries in Nginx's error
log; do not diagnose that state as an Android decoder or upload failure.

## Android distribution

The internal APK is signed with one stable release key and copied to an authenticated download endpoint. The signing key and passwords are backed up outside the server. Losing the key prevents installed clients from accepting upgrades with the same application ID.

The public APK URL is intentionally served by an exact Nginx location rather
than the generic Node.js proxy. Run `sudo -n bash
scripts/deploy/activate-android-downloads.sh` after provisioning or replacing
the `merchedits.xyz` Nginx site. The installer creates a timestamped Nginx
backup, validates configuration before reload, and proves a one-megabyte `206`
response against the published byte count. The stable
`/chat/api/v1/client/android` URL redirects to the public GitHub Release CDN;
friends therefore use a globally distributed endpoint without learning a new
link. `/chat/api/v1/client/android/origin` remains a range-capable recovery
path on the host. Do not add `limit_rate`, compression, or response transforms
to the origin route. Both sources support byte ranges.

APK releases include version code, semantic version, source revision, API compatibility version and SHA-256 in a release manifest.

Android-only releases use a bounded fast path. Run
`npm run release:verify-mobile-only -- --base "$SERVER_REVISION" --revision
"$SOURCE_REVISION"` before building. When it passes, keep the running server,
maintenance revision, containers, database, and backups unchanged and publish
only the verified signed APK and manifest. The gate fails closed if the
revision touches the API, shared contracts, dependency graph, migrations,
containers, infrastructure, or deployment scripts. Only the verifier's own
entrypoint and tests are bootstrap exceptions; all other rejected releases must
use `deploy-production.sh` and its full synchronized backup cycle.

After the APK passes the artifact, signing, public-source, and supply-chain
checks, publish it on the host with temporary files on the same filesystem:

```bash
bash scripts/deploy/publish-android-release.sh \
  /absolute/path/to/snezhok.apk \
  /absolute/path/to/android-next.json \
  /home/merchedits/sites/snezhok-v3/platform/runtime/releases
bash scripts/deploy/verify-production-release.sh "$SOURCE_REVISION"
```

The publisher validates exact source provenance, monotonic version code,
signing identity, byte count and SHA-256, retains immutable versioned files,
then moves the current manifest last so clients never observe a new manifest
with an old APK.
