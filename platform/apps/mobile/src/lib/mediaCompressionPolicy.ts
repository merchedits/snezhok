export function resizeForLongEdge(width: number | null | undefined, height: number | null | undefined, target: number): { width: number } | { height: number } | null {
  if (!width || !height || width <= 0 || height <= 0) return { width: target };
  if (Math.max(width, height) <= target) return null;
  return width >= height ? { width: target } : { height: target };
}

export function replaceImageExtension(filename: string, extension: string): string {
  const safe = filename.trim() || `snezhok-photo-${Date.now()}`;
  return /\.[a-z0-9]{1,8}$/i.test(safe) ? safe.replace(/\.[a-z0-9]{1,8}$/i, `.${extension}`) : `${safe}.${extension}`;
}
