# Android release channel

Android is the primary Snezhok client and the authority for interaction design. The web client follows the mobile product model where browser constraints allow it.

## Stable public endpoints

- Manifest: `https://merchedits.xyz/chat/api/v1/client/android/manifest`
- Current APK: `https://merchedits.xyz/chat/api/v1/client/android`

The server reads `runtime/releases/android-current.json`. Nginx sends
`runtime/releases/snezhok-current.apk` directly from an exact public location;
the API retains an equivalent range implementation for local/API-only
verification and recovery. The ignored `runtime/` tree is mutable deployment
state, while `releases/*.json` remains immutable historical evidence in Git.
These stable runtime paths mean a mobile release does not require changing or
rebuilding the API after the update channel has been deployed.

## Client behavior

Release builds check the manifest shortly after launch and whenever the app returns to the foreground after fifteen minutes. Updates download automatically on Wi-Fi by default. The user can change that preference, check manually, or retry from Settings.

The Android updater downloads to a stable content-addressed cache file. A
native bounded downloader keeps the `.part` file after transient transport or
process failures, validates every `Content-Range`, reconnects with exponential
backoff, and resumes from the durable file length. It verifies the byte count
and SHA-256 from the release manifest before atomically exposing the `.apk` to
the installer. Hashing is a separate visible verification phase; network 100%
must never look like a frozen completed installation. Android then verifies
that the APK is signed by the same release certificate as the installed
application. Android does not permit an ordinary sideloaded app to install an
APK silently: the user must allow Snezhok as an installation source once and
confirm each package update.

The final handoff is native rather than a generic JavaScript intent call. The
client rechecks the cached artifact natively, checks Android's per-source
installation permission before opening the installer, shares the APK through
the application's read-only `FileProvider` grant, and returns to JavaScript as
soon as the system installer is launched. Permission, installer availability,
download, and verification failures remain distinct states in the UI and in
redacted diagnostics; an external installer result is never mistaken for a
failed download.

The manifest publishes the stable domain route first. Nginx redirects it to
the current GitHub Release CDN asset, while the manifest also lists the direct
origin and immutable versioned GitHub asset as fallbacks. A retry rotates
sources while preserving the same validated byte offset, so a poor route does
not restart the transfer. Upload both `snezhok-X.Y.Z.apk` and the stable-name
`snezhok-android.apk` to the public `android-vX.Y.Z` GitHub release before
publishing the matching manifest; all assets must have the exact manifest
SHA-256. The origin remains independently usable and an unverified mirror can
never reach Android's installer.

Release 4.0 introduces durable cooperative activity payloads on system-message anchors. The payload is backward compatible: older installed clients display the Russian fallback system text and continue normal messaging, while 4.0 renders the interactive card. Deploy migration 0018 and the matching API revision before publishing the 4.0 APK.

Release 4.0.1 removes user-selectable accent colors and applies the fixed whimsical Snezhok palette across primary Android destinations and shared menus. The legacy `accent` wire field is retained and normalized to `blue` so 3.x clients and cached settings can cross the update without a schema break.

Release 4.0.2 hardens attachment messages before they enter FlashList. Cached, optimistic, HTTP, and realtime payloads are normalized centrally; malformed nested attachment records cannot reach native media views; attachment children use their durable IDs rather than recycler indexes; and a per-attachment render boundary contains a JavaScript media failure without unmounting the chat.

## Publishing an APK

Classify the APK first. A tester candidate follows the focused validation lane
in [DEVELOPMENT_WORKFLOW.md](./DEVELOPMENT_WORKFLOW.md); a stable promotion
follows the full release gate. Steps that protect upgradeability and artifact
integrity remain mandatory for both.

0. Classify the release before touching production. If the running server is
   `SERVER_REVISION`, prove that the candidate changes only the Android client,
   release documentation, and the mobile version fields:

   ```bash
   npm run release:verify-mobile-only -- \
     --base "$SERVER_REVISION" \
     --revision "$SOURCE_REVISION"
   ```

   A passing mobile-only release does not redeploy the API, worker, PostgreSQL,
   LiveKit, maintenance units, or backups. Mobile-only dependencies are allowed when deployed workspace graphs remain unchanged. Any API, contract, non-mobile dependency,
   migration, Compose, infrastructure, or operational-script change (apart
   from this verifier's own bootstrap files) requires the complete coordinated
   deployment. The production checkout and
   maintenance revision continue to describe the running server; the Android
   manifest independently names the exact public mobile source revision.
1. Increase both `version` and `android.versionCode` in `apps/mobile/app.config.ts`; version codes must never decrease or be reused.
2. For a tester candidate, run the changed mobile workspace typecheck, focused
   tests for the changed behavior, and any targeted risk-boundary check. Do not
   run unrelated monorepo suites. For a stable promotion, run the complete
   required typecheck, test, compliance, and physical-device gates.
3. In a clean checkout, run `npm ci --omit=dev`, Expo prebuild with `--clean --no-install`, then build `assembleRelease` with the protected Snezhok signing environment. The local config plugin injects release signing from `SNEZHOK_KEYSTORE_FILE`, `SNEZHOK_KEYSTORE_PASSWORD`, `SNEZHOK_KEY_ALIAS`, and `SNEZHOK_KEY_PASSWORD`.
4. Verify the APK with `apksigner`, inspect it with `aapt`, and calculate its byte count and SHA-256.
   Run the automated configuration and artifact gates described in [RELEASE_ENGINEERING.md](./RELEASE_ENGINEERING.md); release APKs containing Expo Dev Launcher or Dev Menu are rejected.
5. Create the release manifest with the application ID, semantic version, version code, minimum version code, mandatory flag, byte count, APK SHA-256, signing-certificate SHA-256, publication timestamp, and short release notes. Verify it against both the APK and the currently published manifest with `--previous-manifest`; reused/decreased version codes and signing identity changes are rejected.
6. Upload the APK and manifest under temporary names on the host. Verify both hashes there.
7. Move the APK into `snezhok-current.apk`, then move the manifest into `android-current.json` last. Publishing the manifest last makes the channel atomic from the client's perspective.
8. Request the public manifest, a small byte range, and the complete APK. Confirm version, content length, ETag, SHA-256, and HTTP 206 range behavior.

Keep every versioned APK and manifest as immutable rollback artifacts. Never replace or lose the release keystore; Android will reject future upgrades signed with another key.
