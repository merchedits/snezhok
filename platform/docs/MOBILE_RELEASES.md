# Android release channel

Android is the primary Snezhok client and the authority for interaction design. The web client follows the mobile product model where browser constraints allow it.

## Stable public endpoints

- Manifest: `https://merchedits.xyz/chat/api/v1/client/android/manifest`
- Current APK: `https://merchedits.xyz/chat/api/v1/client/android`

The server reads `runtime/releases/android-current.json` and streams `runtime/releases/snezhok-current.apk`. The ignored `runtime/` tree is mutable deployment state, while `releases/*.json` remains immutable historical evidence in Git. These stable runtime paths mean a mobile release does not require changing or rebuilding the API after the update channel has been deployed.

## Client behavior

Release builds check the manifest shortly after launch and whenever the app returns to the foreground after fifteen minutes. Updates download automatically on Wi-Fi by default. The user can change that preference, check manually, or retry from Settings.

Before opening Android's installer, Snezhok verifies the byte count and SHA-256 from the release manifest. Android then verifies that the APK is signed by the same release certificate as the installed application. Android does not permit an ordinary sideloaded app to install an APK silently: the user must allow Snezhok as an installation source once and confirm each package update.

Release 4.0 introduces durable cooperative activity payloads on system-message anchors. The payload is backward compatible: older installed clients display the Russian fallback system text and continue normal messaging, while 4.0 renders the interactive card. Deploy migration 0018 and the matching API revision before publishing the 4.0 APK.

Release 4.0.1 removes user-selectable accent colors and applies the fixed whimsical Snezhok palette across primary Android destinations and shared menus. The legacy `accent` wire field is retained and normalized to `blue` so 3.x clients and cached settings can cross the update without a schema break.

Release 4.0.2 hardens attachment messages before they enter FlashList. Cached, optimistic, HTTP, and realtime payloads are normalized centrally; malformed nested attachment records cannot reach native media views; attachment children use their durable IDs rather than recycler indexes; and a per-attachment render boundary contains a JavaScript media failure without unmounting the chat.

## Publishing a release

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
2. Run the monorepo type checks and tests.
3. In a clean checkout, run `npm ci --omit=dev`, Expo prebuild with `--clean --no-install`, then build `assembleRelease` with the protected Snezhok signing environment. The local config plugin injects release signing from `SNEZHOK_KEYSTORE_FILE`, `SNEZHOK_KEYSTORE_PASSWORD`, `SNEZHOK_KEY_ALIAS`, and `SNEZHOK_KEY_PASSWORD`.
4. Verify the APK with `apksigner`, inspect it with `aapt`, and calculate its byte count and SHA-256.
   Run the automated configuration and artifact gates described in [RELEASE_ENGINEERING.md](./RELEASE_ENGINEERING.md); release APKs containing Expo Dev Launcher or Dev Menu are rejected.
5. Create the release manifest with the application ID, semantic version, version code, minimum version code, mandatory flag, byte count, APK SHA-256, signing-certificate SHA-256, publication timestamp, and short release notes. Verify it against both the APK and the currently published manifest with `--previous-manifest`; reused/decreased version codes and signing identity changes are rejected.
6. Upload the APK and manifest under temporary names on the host. Verify both hashes there.
7. Move the APK into `snezhok-current.apk`, then move the manifest into `android-current.json` last. Publishing the manifest last makes the channel atomic from the client's perspective.
8. Request the public manifest, a small byte range, and the complete APK. Confirm version, content length, ETag, SHA-256, and HTTP 206 range behavior.

Keep every versioned APK and manifest as immutable rollback artifacts. Never replace or lose the release keystore; Android will reject future upgrades signed with another key.
