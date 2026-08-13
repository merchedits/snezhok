export interface MessageMediaSize {
  width: number;
  height: number;
}

const DEFAULT_WIDTH = 276;
const DEFAULT_HEIGHT = 207;
const MAX_WIDTH = 286;
const MAX_HEIGHT = 420;

/**
 * Reserves a stable message-cell frame before the thumbnail is decoded. Both
 * dimensions are scaled together, so portrait and panoramic media never get
 * stretched merely to satisfy a minimum cell height.
 */
export function messageMediaSize(width: number | null, height: number | null): MessageMediaSize {
  if (!width || !height || width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }
  const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
