# Android APK build

## Native design

Snezhok uses Expo SDK 56 Continuous Native Generation, React Native 0.85, and the official LiveKit Expo plugin. `android/` is generated and intentionally ignored. Do not use Expo Go.

The LiveKit plugin is configured for Android communication audio and its MediaProjection foreground service. Snezhok also ships a native `microphone|camera` foreground service for an already-connected call, with a private ongoing notification that returns to the app. The manifest declares camera, microphone, notification, media playback, and screen-capture foreground-service permissions. Device screen sharing still requires the standard Android confirmation each time capture begins.

## EAS internal APK

This path does not require a local Android SDK.

1. Install dependencies from `platform/` with `npm install`.
2. Set `EXPO_PUBLIC_API_URL` to the public `/api/v1` endpoint.
3. Run `npx eas-cli@20.5.1 init` from `platform/apps/mobile` and retain the generated project ID outside source control or in the EAS environment as `EXPO_PUBLIC_EAS_PROJECT_ID`.
4. Configure the Android application in Firebase, upload its FCM V1 service-account credential to the EAS project, and provide `google-services.json` as the secret build file referenced by `GOOGLE_SERVICES_JSON`.
5. Ensure the commit is already pushed publicly. EAS supplies
   `EAS_BUILD_GIT_COMMIT_HASH`; a local/repacked source tree must instead set
   `SNEZHOK_SOURCE_REVISION` to the exact 40-character public commit.
6. Run `npm run build:apk`.
7. Download the `preview` artifact and verify its signing certificate before distributing the APK.

The `preview` profile produces an internally distributed APK. `production` produces an AAB for a future store release.

## Local signed APK

Install JDK 17, Android Studio, Android SDK Platform 36, Android SDK Build Tools 36.0.0, and current Command-line/Platform Tools. Set `ANDROID_HOME` to `%LOCALAPPDATA%\Android\Sdk` and add `%ANDROID_HOME%\platform-tools` to `PATH`.

```powershell
cd platform\apps\mobile
npx expo prebuild --clean --platform android
.\android\gradlew.bat :app:assembleDebug
```

The debug APK is written below `android/app/build/outputs/apk/debug/`.

For a private release build, create one long-lived upload keystore and expose its path and credentials through the `SNEZHOK_KEYSTORE_*` environment variables. The local Expo config plugin applies that signing configuration during every prebuild, including clean prebuilds. Run `android\gradlew.bat :app:assembleRelease`. Keep the key backed up separately: losing it prevents installing an update over existing sideloaded copies.

See `../../docs/MOBILE_RELEASES.md` for the web-hosted update channel and atomic publication procedure.

## Release checks

1. Run the workspace mobile typecheck and Expo Doctor.
2. Verify login, token refresh, and logout against production.
3. Test cached startup and queued text sends in airplane mode.
4. Upload an image in every quality mode and resume an interrupted multi-chunk file.
5. Test microphone, camera, speaker/earpiece, Bluetooth, and screen capture on Android 13 through 16.
6. Exercise LiveKit reconnect and TURN fallback from Wi-Fi and mobile data.
7. Minimize an active call, browse chats/servers, lock the screen, and confirm audio plus the ongoing call notification remain active.
8. Confirm that leaving a group or voice channel disconnects only that participant, while the explicit moderator action ends the room for everyone.
9. Confirm file and thumbnail requests include bearer authorization.
10. Increment `android.versionCode` and `version` for every distributed update.

## Infrastructure required for calls

The APK can build without a running media server, but calls require `/api/v1/calls/token` and a reachable LiveKit deployment. The public host must expose WSS signaling and WebRTC media ports; a reverse proxy for WSS alone is insufficient.

Expo Push supplies message, incoming-call, answer with audio, answer with video, decline, and missed-call notifications while the app is backgrounded or terminated. This path is inactive in builds without `EXPO_PUBLIC_EAS_PROJECT_ID`, `google-services.json`, and the matching FCM V1 credential; foreground Socket.IO notifications remain as a fallback. Android may defer quiet call-ended cleanup in Doze mode, so the incoming notification also expires after 90 seconds.

The foreground service satisfies Android's background microphone/camera execution contract for an already-connected LiveKit room. It does not recreate media after a force-stop or process death and it is not an Android Telecom `ConnectionService`; do not describe the client as a carrier-style call replacement. Physical two-device validation is still required for every release.
