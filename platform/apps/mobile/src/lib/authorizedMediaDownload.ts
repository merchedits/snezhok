import { File } from "expo-file-system";

import { authorizedMediaSource, refreshAuthorizedMediaSession } from "../hooks/useAuthorizedMedia";

/** Downloads protected media and retries once after rotating an expired token. */
export async function downloadAuthorizedMedia(uri: string, destination: File): Promise<File> {
  let firstError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (destination.exists) destination.delete();
    const source = authorizedMediaSource(uri);
    const task = File.createDownloadTask(source.uri, destination, { headers: source.headers });
    try {
      const downloaded = await task.downloadAsync();
      if (!downloaded?.exists) throw new Error("Protected attachment download did not produce a file");
      return downloaded;
    } catch (error) {
      firstError ??= error;
      if (attempt > 0 || !await refreshAuthorizedMediaSession()) throw firstError;
    } finally {
      task.release();
    }
  }
  throw firstError ?? new Error("Protected attachment download failed");
}
