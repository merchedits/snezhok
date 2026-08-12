import type { ConfigContext, ExpoConfig } from "expo/config";

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "https://merchedits.xyz/chat/api/v1";
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
const sourceRevision = process.env.SNEZHOK_SOURCE_REVISION ?? process.env.EAS_BUILD_GIT_COMMIT_HASH ?? "development";

if (process.env.SNEZHOK_RELEASE_BUILD === "1" && !/^[0-9a-f]{40}$/i.test(sourceRevision)) {
  throw new Error("SNEZHOK_SOURCE_REVISION must be the complete public Git commit used for a release build");
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Snezhok",
  slug: "snezhok",
  version: "4.2.0",
  description: "Private messages, shared moments, files and calls.",
  platforms: ["android"],
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  scheme: "snezhok",
  icon: "./assets/snezhok-flower-icon.png",
  runtimeVersion: { policy: "appVersion" },
  plugins: [
    [
      "expo-font",
      {
        fonts: [
          {
            fontFamily: "Onest",
            fontDefinitions: [
              { path: "../../node_modules/@expo-google-fonts/onest/400Regular/Onest_400Regular.ttf", weight: 400 },
              { path: "../../node_modules/@expo-google-fonts/onest/500Medium/Onest_500Medium.ttf", weight: 500 },
              { path: "../../node_modules/@expo-google-fonts/onest/600SemiBold/Onest_600SemiBold.ttf", weight: 600 },
              { path: "../../node_modules/@expo-google-fonts/onest/700Bold/Onest_700Bold.ttf", weight: 700 },
              { path: "../../node_modules/@expo-google-fonts/onest/800ExtraBold/Onest_800ExtraBold.ttf", weight: 800 },
              { path: "../../node_modules/@expo-google-fonts/onest/900Black/Onest_900Black.ttf", weight: 900 },
            ],
          },
        ],
      },
    ],
    "./plugins/withReleaseSigning.cjs",
    "./plugins/withLegalAssets.cjs",
    "./plugins/withAndroidPerformance.cjs",
    "expo-image",
    "expo-audio",
    [
      "@livekit/react-native-expo-plugin",
      {
        android: {
          audioType: "communication",
          enableScreenShareService: true,
        },
      },
    ],
    "@config-plugins/react-native-webrtc",
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["arm64-v8a", "armeabi-v7a"],
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
    ["expo-secure-store", { configureAndroidBackup: true }],
    "expo-notifications",
    [
      "expo-media-library",
      {
        photosPermission: "Allow Snezhok to access photos.",
        savePhotosPermission: "Allow Snezhok to save photos.",
        granularPermissions: ["photo", "video"],
        isAccessMediaLocationEnabled: false,
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Allow Snezhok to attach photos and videos.",
        cameraPermission: "Allow Snezhok to capture photos and video messages.",
        microphonePermission: "Allow Snezhok to record video and voice messages.",
      },
    ],
  ],
  android: {
    package: "xyz.merchedits.snezhok",
    versionCode: 37,
    // Messages, drafts and the durable outbox are private local data. They
    // must never leave the app sandbox through Android cloud/ADB backup.
    allowBackup: false,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    softwareKeyboardLayoutMode: "resize",
    adaptiveIcon: {
      foregroundImage: "./assets/snezhok-flower-icon.png",
      backgroundColor: "#121218",
    },
    permissions: [
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
      "android.permission.FOREGROUND_SERVICE_CAMERA",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
      "android.permission.REQUEST_INSTALL_PACKAGES",
    ],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: "https",
            host: "merchedits.xyz",
            pathPrefix: "/chat",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  extra: {
    apiUrl,
    sourceRevision,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
});
