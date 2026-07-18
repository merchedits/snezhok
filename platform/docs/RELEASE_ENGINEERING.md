# Release engineering

## Android profiles

`expo-dev-client` is a development-only dependency. The EAS `development` profile retains it; `preview` and `production` set `NPM_CONFIG_OMIT=dev`, select matching EAS environments, and identify themselves as release builds. This separation is meaningful only when the final binary is inspected, so configuration and artifact checks are both mandatory.

For the sideloaded updater, build the production-like `preview` APK with the protected Snezhok signing environment. The Play-style `production` profile emits an AAB. Do not promote an AAB until a universal APK generated from it passes the same inspection.

```bash
npm run release:verify-config
npm run build:apk --workspace=@snezhok/mobile
npm run release:verify-apk -- \
  --apk /absolute/path/to/snezhok.apk \
  --manifest /absolute/path/to/android-next.json \
  --previous-manifest releases/android-current.json
```

Never create a local release from a development `node_modules`. Use a clean
checkout and `npm ci --omit=dev` before `expo prebuild --clean --no-install`.
The EAS `preview` environment must contain the file variables
`SNEZHOK_KEYSTORE_FILE` and `GOOGLE_SERVICES_JSON`, the protected keystore
password/alias variables, and `EXPO_PUBLIC_EAS_PROJECT_ID`. The production
environment needs the same values before an AAB build. Missing push or signing
configuration is a release blocker, not a reason to build a reduced binary.

The artifact gate verifies:

- application ID, version name and monotonically assigned version code;
- exact ABI set rather than silently shipping emulator or 32-bit libraries;
- a non-debuggable manifest and a valid v2/v3 APK signature;
- the expected signing-certificate SHA-256;
- byte count and APK SHA-256 from the publication manifest;
- a public Git source revision for GPL corresponding-source traceability;
- monotonic version code and unchanged application/signing identity compared
  with the currently published manifest;
- absence of `expo.modules.devlauncher` and `expo.modules.devmenu` in defined DEX packages.

The currently published APK is expected to fail the last check until a new production-only dependency build replaces it. Never weaken the check to publish that artifact.

## Continuous integration

The repository-root `.github/workflows/platform-ci.yml` performs lockfile installation, a high-severity production dependency audit, type checks, unit tests, production builds, Expo Doctor, shell linting, Python compilation, systemd unit validation, Compose rendering, container builds and release-profile validation. A separate job installs production dependencies only, generates an ephemeral CI signing certificate, prebuilds Android, assembles a minimized release APK and runs the artifact verifier. Dependabot groups routine npm updates weekly and GitHub Actions updates monthly.

CI signing proves build integrity but not upgrade compatibility. The protected production certificate is never placed in CI unless a dedicated protected release workflow is introduced. Published artifacts must still be signed by the offline-backed Snezhok key and compared to its pinned certificate digest.

`npm run lint` currently combines the TypeScript compiler with tests for operational scripts. ShellCheck runs in CI. This correctness-first strategy avoids a repository-wide formatting rewrite while a team formatter is selected. Once adopted, add it in check-only mode first, format one bounded area per pull request, and never combine mechanical formatting with behavior changes.

`npm audit --omit=dev` currently reports the moderate `uuid` buffer advisory
through Expo's build-time `xcode` tooling. It is not imported by Snezhok's
runtime bundle, and npm's suggested forced remediation downgrades Expo across
major versions. The CI gate therefore rejects high/critical findings while
Dependabot and Expo SDK upgrades remain the safe remediation path. Re-evaluate
this exception on every Expo update; do not add a permanent audit ignore.
