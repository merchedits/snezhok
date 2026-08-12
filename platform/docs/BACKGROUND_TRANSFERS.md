# Android background transfers

> Release status (2026-08-13): user-initiated Android chat attachments use the durable WorkManager implementation below. A staged source survives process death and the final chat message remains idempotent. The foreground resumable implementation is retained only as a compatibility fallback when an interrupted upgrade or restored older native binary does not contain the module. Photo, video, document, voice, cancellation, process-death, and reconnect behavior remains part of every physical release gate.

Snezhok uploads attachments through a durable, resumable Android pipeline. The
JavaScript process remains responsible for creating the eventual message, but
the file transfer itself survives navigation, process death, network changes,
and device reboot.

## Security model

1. The signed-in client creates an upload session with its normal bearer token.
2. The API returns 32 random bytes as an unpadded base64url upload capability.
   PostgreSQL stores only its SHA-256 digest.
3. The capability is valid for exactly one upload and only while both the
   upload and the device session that created it remain active. Revoking that
   device session immediately invalidates the capability.
4. Android stores the capability in the app-private, no-backup transfer
   directory. WorkManager receives only a transfer UUID; bearer and refresh
   tokens are never placed in WorkManager input, progress, output, logs, URLs,
   or notifications.
5. `HEAD`, chunk `PATCH`, whole-content `PUT`, completion, and cancellation
   accept either the owning authenticated account or the scoped capability via
   `Upload-Capability`. Redirects are disabled so the header cannot cross an
   origin boundary. The API logger redacts the capability header.

Capabilities are intentionally not download credentials. Completed files still
use the normal attachment authorization rules.

## Durability and idempotency

- The selected source is copied and fsynced into the app's durable no-backup
  files before WorkManager is scheduled. Cache URIs are never used as the
  worker's long-term source.
- A `CoroutineWorker` uses a connected or unmetered network constraint,
  exponential retry, an Android `dataSync` foreground service, a stock progress
  notification, and a cancellation action.
- Every retry starts with `HEAD` and resumes from the authoritative server
  offset. Chunk progress is monotonic. Completion is idempotent, including the
  case where the server committed the attachment but the response was lost.
- The JS queue is persisted before upload initialization. It records stable
  transfer IDs and stable message `clientId` values, never account tokens. On
  resume it reconciles native results, sends groups of at most ten media items,
  and retries the same idempotent message ID after a crash. A 23-item selection
  therefore becomes 10 + 10 + 3 without duplicates.
- Signing out cancels native work, requests remote cancellation, deletes staged
  sources, and clears the account's pending intent queue.

## Android compatibility

The module uses WorkManager 2.11.2, targets the app's API 36 toolchain, and
retains the application's API 24 minimum. `SystemForegroundService` declares
the `dataSync` type and the app requests
`android.permission.FOREGROUND_SERVICE_DATA_SYNC`, as required on Android 14+
and accepted on the Samsung A12's Android 12 runtime.

Android 16 counts long-running WorkManager jobs against job quota. Snezhok keeps
chunks small, uses one worker per selected item, and relies on WorkManager's
backoff instead of busy retry loops. Very large real-device uploads should be
included in release qualification; this implementation does not claim physical
Samsung A12 or Android 16 evidence until those tests are actually run.

## Release checks

- Run the API migration and capability/channel-authorization tests.
- Run the mobile transfer-model tests.
- Run `:snezhok-background-transfer:testDebugUnitTest` and
  `:snezhok-background-transfer:compileDebugKotlin`.
- Inspect the merged release manifest for the `dataSync` foreground service and
  permission.
- On physical devices, test Wi-Fi loss/recovery, mobile/unmetered constraints,
  reboot during upload, notification cancellation, session revocation, process
  kill after completion but before message dispatch, and selections above ten
  items.
