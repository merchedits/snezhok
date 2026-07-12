# Android APK build

## Native design

Snezhok uses Expo SDK 56 Continuous Native Generation, React Native 0.85, and the official LiveKit Expo plugin. `android/` is generated and intentionally ignored. Do not use Expo Go.

The LiveKit plugin is configured for Android communication audio and its MediaProjection foreground service. The manifest also declares camera, microphone, notification, media playback, and screen-capture foreground-service permissions. Device screen sharing still requires the standard Android confirmation each time capture begins.

## EAS internal APK

This path does not require a local Android SDK.

1. Install dependencies from `platform/` with `npm install`.
2. Set `EXPO_PUBLIC_API_URL` to the public `/api/v1` endpoint.
3. Run `npx eas-cli@20.5.1 init` from `platform/apps/mobile` and retain the generated project ID outside source control or in the EAS environment as `EXPO_PUBLIC_EAS_PROJECT_ID`.
4. Run `npm run build:apk`.
5. Download the `preview` artifact and verify its signing certificate before distributing the APK.

The `preview` profile produces an internally distributed APK. `production` produces an AAB for a future store release.

## Local signed APK

Install JDK 17, Android Studio, Android SDK Platform 35, Android SDK Build Tools 36.0.0, and current Command-line/Platform Tools. Set `ANDROID_HOME` to `%LOCALAPPDATA%\Android\Sdk` and add `%ANDROID_HOME%\platform-tools` to `PATH`.

```powershell
cd platform\apps\mobile
npx expo prebuild --clean --platform android
.\android\gradlew.bat :app:assembleDebug
```

The debug APK is written below `android/app/build/outputs/apk/debug/`.

For a private release build, create one long-lived upload keystore, configure its path and passwords through an untracked Gradle properties file or CI secrets, then run `android\gradlew.bat :app:assembleRelease`. Keep the key backed up separately: losing it prevents installing an update over existing sideloaded copies.

## Release checks

1. Run the workspace mobile typecheck and Expo Doctor.
2. Verify login, token refresh, and logout against production.
3. Test cached startup and queued text sends in airplane mode.
4. Upload an image in every quality mode and resume an interrupted multi-chunk file.
5. Test microphone, camera, speaker/earpiece, Bluetooth, and screen capture on Android 13 through 16.
6. Exercise LiveKit reconnect and TURN fallback from Wi-Fi and mobile data.
7. Confirm file and thumbnail requests include bearer authorization.
8. Increment `android.versionCode` and `version` for every distributed update.

## Infrastructure required for calls

The APK can build without a running media server, but calls require `/api/v1/calls/token` and a reachable LiveKit deployment. The public host must expose WSS signaling and WebRTC media ports; a reverse proxy for WSS alone is insufficient.

Normal background call persistence and incoming system call notifications require a dedicated Android foreground-call/notification integration in addition to the screen-share service. Complete and device-test that integration before describing the APK as background-call capable.
