export const MEDIA_CACHE_LIMITS_MB = [128, 256, 512] as const;
export type MediaCacheLimitMb = (typeof MEDIA_CACHE_LIMITS_MB)[number];
export const DEFAULT_MEDIA_CACHE_LIMIT_MB: MediaCacheLimitMb = 256;

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.max(0.1, bytes / 1024 / 1024).toFixed(1)} MB`;
}
