# Android release channel

Android is the primary Snezhok client and the authority for interaction design. The web client follows the mobile product model where browser constraints allow it.

## Stable public endpoints

- Manifest: `https://merchedits.xyz/chat/api/v1/client/android/manifest`
- Current APK: `https://merchedits.xyz/chat/api/v1/client/android`

The server reads `releases/android-current.json` and streams `releases/snezhok-current.apk`. These stable paths mean a mobile release does not require changing or rebuilding the API after the update channel has been deployed.

## Client behavior

Release builds check the manifest shortly after launch and whenever the app returns to the foreground after fifteen minutes. Updates download automatically on Wi-Fi by default. The user can change that preference, check manually, or retry from Settings.

Before opening Android's installer, Snezhok verifies the byte count and SHA-256 from the release manifest. Android then verifies that the APK is signed by the same release certificate as the installed application. Android does not permit an ordinary sideloaded app to install an APK silently: the user must allow Snezhok as an installation source once and confirm each package update.

## Publishing a release

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
