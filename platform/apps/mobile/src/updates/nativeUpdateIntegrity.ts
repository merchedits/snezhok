import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

interface UpdateIntegrityModule {
  sha256File(uri: string): Promise<string>;
}

const nativeModule = requireOptionalNativeModule<UpdateIntegrityModule>("SnezhokCallService");

/** Hashes the APK through a bounded native stream instead of copying it into the JS heap. */
export async function sha256UpdateFile(uri: string): Promise<string> {
  if (Platform.OS !== "android" || !nativeModule) {
    throw new Error("Native Android update verification is unavailable");
  }
  const digest = await nativeModule.sha256File(uri);
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("Native Android update verification returned an invalid digest");
  return digest;
}
