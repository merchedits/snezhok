import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

interface CallForegroundServiceModule {
  start(title: string, body: string, videoEnabled: boolean): boolean;
  update(title: string, body: string, videoEnabled: boolean): boolean;
  stop(): boolean;
  playOutputTest(): boolean;
}

const nativeModule = requireOptionalNativeModule<CallForegroundServiceModule>("SnezhokCallService");

export function startCallForegroundService(title: string, body: string, videoEnabled = false): boolean {
  if (Platform.OS !== "android") return false;
  return nativeModule?.start(title, body, videoEnabled) ?? false;
}

export function updateCallForegroundService(title: string, body: string, videoEnabled: boolean): boolean {
  if (Platform.OS !== "android") return false;
  return nativeModule?.update(title, body, videoEnabled) ?? false;
}

export function stopCallForegroundService(): boolean {
  if (Platform.OS !== "android") return false;
  return nativeModule?.stop() ?? false;
}

export function playCallOutputTest(): boolean {
  if (Platform.OS !== "android") return false;
  return nativeModule?.playOutputTest() ?? false;
}
