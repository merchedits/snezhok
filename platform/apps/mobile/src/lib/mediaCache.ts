import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { clearVideoCacheAsync, getCurrentVideoCacheSize, setVideoCacheSizeAsync } from "expo-video";
import { DEFAULT_MEDIA_CACHE_LIMIT_MB, MEDIA_CACHE_LIMITS_MB, type MediaCacheLimitMb } from "./mediaCachePolicy";

const MEDIA_CACHE_LIMIT_KEY = "@snezhok/media-cache/limit-mb/v1";
export { DEFAULT_MEDIA_CACHE_LIMIT_MB, formatStorageBytes, MEDIA_CACHE_LIMITS_MB, type MediaCacheLimitMb } from "./mediaCachePolicy";

export async function initializeMediaCache(): Promise<MediaCacheLimitMb> {
  const limit = await mediaCacheLimit();
  await setVideoCacheSizeAsync(limit * 1024 * 1024);
  return limit;
}

export async function mediaCacheLimit(): Promise<MediaCacheLimitMb> {
  const stored = Number(await AsyncStorage.getItem(MEDIA_CACHE_LIMIT_KEY));
  return MEDIA_CACHE_LIMITS_MB.includes(stored as MediaCacheLimitMb) ? stored as MediaCacheLimitMb : DEFAULT_MEDIA_CACHE_LIMIT_MB;
}

export async function setMediaCacheLimit(limit: MediaCacheLimitMb): Promise<void> {
  if (!MEDIA_CACHE_LIMITS_MB.includes(limit)) throw new Error("Unsupported media cache limit");
  await setVideoCacheSizeAsync(limit * 1024 * 1024);
  await AsyncStorage.setItem(MEDIA_CACHE_LIMIT_KEY, String(limit));
}

export function currentMediaCacheBytes(): number {
  const bytes = getCurrentVideoCacheSize();
  return Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
}

export async function clearMediaCache(): Promise<void> {
  await Promise.all([
    clearVideoCacheAsync(),
    Image.clearDiskCache(),
    Image.clearMemoryCache(),
  ]);
}
