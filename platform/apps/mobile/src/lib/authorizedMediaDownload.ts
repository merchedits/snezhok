import { File } from "expo-file-system";

import { authorizedMediaSource, refreshAuthorizedMediaSession } from "../hooks/useAuthorizedMedia";

interface AuthorizedDownloadOptions {
  onProgress?: ((progress: { bytesWritten: number; totalBytes: number }) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/** Downloads protected media and retries once after rotating an expired token. */
export async function downloadAuthorizedMedia(uri: string, destination: File, options: AuthorizedDownloadOptions = {}): Promise<File> {
  let firstError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException("Download cancelled", "AbortError");
    if (destination.exists) destination.delete();
    const source = authorizedMediaSource(uri);
    const task = File.createDownloadTask(source.uri, destination, {
      headers: source.headers,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    try {
      const downloaded = await task.downloadAsync();
      if (!downloaded?.exists) throw new Error("Protected attachment download did not produce a file");
      return downloaded;
    } catch (error) {
      firstError ??= error;
      if (options.signal?.aborted) throw error;
      if (attempt > 0 || !await refreshAuthorizedMediaSession()) throw firstError;
    } finally {
      task.release();
    }
  }
  throw firstError ?? new Error("Protected attachment download failed");
}
