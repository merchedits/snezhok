import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

export type NativeUpdateDownloadPhase = "downloading" | "retrying" | "verifying";

export interface NativeUpdateDownloadProgress {
  destinationUri: string;
  phase: NativeUpdateDownloadPhase;
  bytesWritten: number;
  totalBytes: number;
  attempt: number;
}

export interface NativeUpdateDownloadResult {
  uri: string;
  bytes: number;
  sha256: string;
}

interface Subscription { remove(): void }

interface NativeUpdateDownloadModule {
  downloadUpdate(urls: string[], destinationUri: string, expectedBytes: number, expectedSha256: string): Promise<NativeUpdateDownloadResult>;
  addListener(
    eventName: "onUpdateDownloadProgress",
    listener: (progress: NativeUpdateDownloadProgress) => void,
  ): Subscription;
}

const nativeModule = requireOptionalNativeModule<NativeUpdateDownloadModule>("SnezhokCallService");

/**
 * Downloads an APK to a stable cache path, retaining its `.part` file across
 * transport failures and app restarts. The native side validates every range
 * response, bounds disk usage, hashes the completed artifact, and only then
 * atomically exposes the final APK.
 */
export async function downloadAndroidUpdate(
  urls: string[],
  destinationUri: string,
  expectedBytes: number,
  expectedSha256: string,
  onProgress: (progress: NativeUpdateDownloadProgress) => void,
): Promise<NativeUpdateDownloadResult> {
  if (Platform.OS !== "android" || !nativeModule) {
    throw new Error("Native Android update download is unavailable");
  }
  const subscription = nativeModule.addListener("onUpdateDownloadProgress", (progress) => {
    if (progress.destinationUri === destinationUri) onProgress(progress);
  });
  try {
    const result = await nativeModule.downloadUpdate(urls, destinationUri, expectedBytes, expectedSha256.toLowerCase());
    // The requested destination is already constrained to the application
    // cache by the native module. URI text may be canonicalized differently
    // across Android/Expo versions, so integrity is established by bytes and
    // digest rather than fragile string equality.
    if (result.bytes !== expectedBytes || result.sha256 !== expectedSha256.toLowerCase()) {
      throw new Error("Native Android update verification returned an invalid result");
    }
    return result;
  } finally {
    subscription.remove();
  }
}
