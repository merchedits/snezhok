import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

export type NativeUpdateInstallStatus =
  | "launched"
  | "permission-required"
  | "installer-unavailable"
  | "settings-unavailable";

interface NativeUpdateInstallResult {
  status: NativeUpdateInstallStatus;
}

interface NativeUpdateInstallerModule {
  installUpdate(
    destinationUri: string,
    expectedBytes: number,
    expectedSha256: string,
  ): Promise<NativeUpdateInstallResult>;
}

const nativeModule = requireOptionalNativeModule<NativeUpdateInstallerModule>("SnezhokCallService");
const VALID_STATUSES = new Set<NativeUpdateInstallStatus>([
  "launched",
  "permission-required",
  "installer-unavailable",
  "settings-unavailable",
]);

/**
 * Hands a verified cached APK to Android. The native side owns FileProvider
 * access, unknown-source permission routing and installer launch so JavaScript
 * never has to await an external Activity result.
 */
export async function requestAndroidUpdateInstallation(
  destinationUri: string,
  expectedBytes: number,
  expectedSha256: string,
): Promise<NativeUpdateInstallStatus> {
  if (Platform.OS !== "android" || !nativeModule) {
    throw new Error("Native Android update installer is unavailable");
  }
  const result = await nativeModule.installUpdate(destinationUri, expectedBytes, expectedSha256.toLowerCase());
  if (!result || !VALID_STATUSES.has(result.status)) {
    throw new Error("Native Android update installer returned an invalid result");
  }
  return result.status;
}
