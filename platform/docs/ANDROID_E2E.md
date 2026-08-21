# Android messaging end-to-end tests

Snezhok's Android messaging smoke suite drives an installed application through
UIAutomator. It uses the real release UI, SQLite projection, network transport,
media picker, WorkManager upload path, protected media reader, and Android
process lifecycle. The test-only instrumentation APK is a separate package and
is never bundled into Snezhok.

## Trust boundary

The suite never stores or accepts an account password. Install the candidate
APK, sign in to a dedicated test account once, and leave the account signed in.
The default journeys use Saved Messages so they cannot address another user.
They create only clearly prefixed text and one copy of the mascot image.

Use a dedicated staging or test account. Running the suite against a personal
account is technically possible but not release evidence. A future
two-participant suite must use an isolated staging database and media root; a
production-only account seeder or deletion backdoor is prohibited.

Evidence contains a hash of the Android serial, device model, Android/app
versions, fixture hash, timings, and redacted instrumentation output. It does
not contain credentials, account identifiers, message history, screenshots, or
raw UI hierarchy dumps.

## One-time device preparation

1. Enable USB debugging and authorize this workstation, or start an Android
   emulator.
2. Install the candidate APK and sign in once.
3. Open Chats once and confirm Saved Messages is present.
4. Keep the screen unlocked while the suite runs.

On Windows the emulator requires CPU virtualization. Enable SVM/AMD-V or VT-x
in firmware and install either Windows Hypervisor Platform or the Android
Emulator Hypervisor Driver. `emulator -accel-check` must report an installed and
usable hypervisor. This requirement does not apply to a USB-connected phone.

## Commands

From `platform/`:

```powershell
npm run e2e:android:prepare
npm run e2e:android:messaging
npm run e2e:android:voice
```

`prepare` performs Expo prebuild and compiles the standalone instrumentation
APK without requiring a connected device. `messaging` runs text send, offline
process-restart/cache recovery, attachment drawer, photo upload/viewer, and a
generated video upload/viewer.
`voice` adds a real microphone recording, upload, and playback-start journey.

When more than one Android device is connected, select one without exposing its
serial in a committed command:

```powershell
$env:SNEZHOK_ANDROID_SERIAL = '<adb serial>'
npm run e2e:android:messaging
```

The runner may optionally install an exact candidate before testing:

```powershell
node scripts/android/run-messaging-e2e.mjs --apk 'F:\path\to\candidate.apk'
```

It pushes `snezhok-e2e-photo.png` and records a two-second solid-color frame
from a test-only activity into the dedicated `Pictures/SnezhokE2E/` directory.
No Snezhok or device content enters that fixture. The runner requests only the runtime permissions needed
by the journeys, and uses observable UI state instead of fixed synchronization
sleeps. The only duration-based operation is holding the microphone long enough
to create a valid voice note.

## Results

The command fails on the first broken journey and writes a private report to:

```text
runtime/evidence/android-e2e/<source-revision>/<timestamp>/report.json
```

A passing emulator run proves functional integration but not Samsung firmware,
microphone quality, animation smoothness, memory pressure, or A12 performance.
Before release, repeat `e2e:android:voice` on the SM-A125F and run
`npm run release:verify-android-physical`.

## Current coverage and next stage

Covered:

- text send and durable visibility after Android process death;
- cached reopening of Saved Messages;
- attachment drawer availability;
- gallery discovery, photo upload, rendered photo, and authenticated viewer;
- generated video upload, rendered preview, and authenticated viewer;
- optional real microphone record/send/playback start.

The next stage is a two-device staging orchestrator for recipient delivery,
read cursors, realtime deduplication, offline reconciliation, albums, video,
transfer interruption, and account switching. It must provision and reset only
an isolated staging environment and retain the same privacy-safe evidence model.
