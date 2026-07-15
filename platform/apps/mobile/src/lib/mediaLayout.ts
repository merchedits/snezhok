export interface MessageMediaSize {
  width: number;
  height: number;
}

const DEFAULT_WIDTH = 250;
const DEFAULT_HEIGHT = 190;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 300;

/**
 * Reserves a stable message-cell frame before the thumbnail is decoded. Very
 * wide and very tall media is bounded to keep one attachment from monopolising
 * the viewport; the full aspect ratio remains available in the media viewer.
 */
export function messageMediaSize(width: number | null, height: number | null): MessageMediaSize {
  if (!width || !height || width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }
  return {
    width: DEFAULT_WIDTH,
    height: Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, DEFAULT_WIDTH * height / width))),
  };
}
