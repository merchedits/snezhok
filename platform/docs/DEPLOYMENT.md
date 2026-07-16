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
4. Run SQL migrations in a one-shot deployment task.
5. Start PostgreSQL, the app and LiveKit without changing Nginx.
6. Verify app, PostgreSQL and LiveKit health; inspect logs and resource limits.
   For production call fallback, follow [CALL_CONNECTIVITY.md](./CALL_CONNECTIVITY.md) and pass its external STUN/TLS smoke test plus a real two-device relayed call.
7. Exercise registration/login, bootstrap, send/retry, uploads/ranges, realtime resume, calls and screen share.
   Verify a message, incoming call, decline and missed call with the APK process terminated. A build without `EXPO_PUBLIC_EAS_PROJECT_ID`, `GOOGLE_SERVICES_JSON` and the EAS FCM V1 credential cannot pass this gate.
8. Run the final data migration and count/hash report.
9. Validate Nginx configuration, switch the `/chat/` upstream to port 3003 and reload.
10. Verify the public web app and APK against production.

## Rollback

Nginx can be switched back to port 3002 without modifying legacy data. Restore v3 PostgreSQL and media from the same backup point when a v3 rollback is required. Never restore only one side of the database/media pair.

## Android distribution

The internal APK is signed with one stable release key and copied to an authenticated download endpoint. The signing key and passwords are backed up outside the server. Losing the key prevents installed clients from accepting upgrades with the same application ID.

APK releases include version code, semantic version, source revision, API compatibility version and SHA-256 in a release manifest.
