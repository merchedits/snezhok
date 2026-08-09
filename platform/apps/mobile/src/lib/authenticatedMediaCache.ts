import { Directory, File, Paths } from "expo-file-system";

import type { AuthenticatedMediaSource } from "../hooks/useAuthorizedMedia";
import { authenticatedMediaFilename } from "./authenticatedMediaCachePolicy";

const cacheDirectory = new Directory(Paths.cache, "snezhok-authenticated-media-v1");
const pendingDownloads = new Map<string, Promise<string>>();

export async function cachedAuthenticatedMedia(
  source: AuthenticatedMediaSource,
  cacheKey: string,
  mimeType?: string | null,
): Promise<string> {
  if (!source.uri) throw new Error("Media URL is unavailable");
  const filename = authenticatedMediaFilename(cacheKey, source.uri, mimeType);
  const existing = new File(cacheDirectory, filename);
  if (existing.exists && (existing.size ?? 0) > 0) return existing.uri;

  const pendingKey = existing.uri;
  const pending = pendingDownloads.get(pendingKey);
  if (pending) return pending;

  const download = downloadAuthenticatedMedia(source, existing).finally(() => {
    pendingDownloads.delete(pendingKey);
  });
  pendingDownloads.set(pendingKey, download);
  return download;
}

export function cachedAuthenticatedMediaUri(cacheKey: string, uri: string, mimeType?: string | null): string | null {
  if (!uri) return null;
  const file = new File(cacheDirectory, authenticatedMediaFilename(cacheKey, uri, mimeType));
  return file.exists && (file.size ?? 0) > 0 ? file.uri : null;
}

export function clearAuthenticatedMediaCache(): void {
  pendingDownloads.clear();
  if (cacheDirectory.exists) cacheDirectory.delete();
}

export function invalidateAuthenticatedMedia(cacheKey: string, uri: string, mimeType?: string | null): void {
  if (!uri) return;
  const file = new File(cacheDirectory, authenticatedMediaFilename(cacheKey, uri, mimeType));
  if (file.exists) file.delete();
}

async function downloadAuthenticatedMedia(source: AuthenticatedMediaSource, destination: File): Promise<string> {
  cacheDirectory.create({ idempotent: true, intermediates: true });
  if (destination.exists) destination.delete();
  const task = File.createDownloadTask(source.uri, destination, { headers: source.headers });
  try {
    const downloaded = await task.downloadAsync();
    if (!downloaded?.exists || (downloaded.size ?? 0) <= 0) throw new Error("Media download returned an empty file");
    return downloaded.uri;
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  } finally {
    task.release();
  }
}
