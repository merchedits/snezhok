import type { ConfigContext, ExpoConfig } from "expo/config";

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "https://merchedits.xyz/chat/api/v1";
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Snezhok",
  slug: "snezhok",
  version: "3.4.0",
  description: "Private messages, files, servers and calls.",
  platforms: ["android"],
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  scheme: "snezhok",
  icon: "./assets/snezhok-icon.png",
  runtimeVersion: { policy: "appVersion" },
  plugins: [
    "./plugins/withReleaseSigning.cjs",
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
          buildArchs: ["arm64-v8a"],
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
    ["expo-secure-store", { configureAndroidBackup: true }],
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
    versionCode: 5,
    softwareKeyboardLayoutMode: "resize",
    adaptiveIcon: {
      foregroundImage: "./assets/snezhok-icon.png",
      backgroundColor: "#06101f",
    },
    permissions: [
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.FOREGROUND_SERVICE",
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
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
});
