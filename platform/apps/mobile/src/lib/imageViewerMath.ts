export interface ImagePanBounds {
  x: number;
  y: number;
}

/**
 * Returns screen-space pan limits for a contained image at the requested zoom.
 * React Native applies the translation after the scale in this transform, so
 * the bounds must not be divided by scale.
 */
export function imagePanBounds(viewportWidth: number, viewportHeight: number, imageWidth: number, imageHeight: number, scale: number): ImagePanBounds {
  "worklet";
  const safeViewportWidth = Math.max(0, viewportWidth);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const safeScale = Math.max(1, scale);
  let containedWidth = safeViewportWidth;
  let containedHeight = safeViewportHeight;
  if (imageWidth > 0 && imageHeight > 0 && safeViewportWidth > 0 && safeViewportHeight > 0) {
    const imageRatio = imageWidth / imageHeight;
    const viewportRatio = safeViewportWidth / safeViewportHeight;
    if (imageRatio >= viewportRatio) containedHeight = safeViewportWidth / imageRatio;
    else containedWidth = safeViewportHeight * imageRatio;
  }
  return {
    x: Math.max(0, (containedWidth * safeScale - safeViewportWidth) / 2),
    y: Math.max(0, (containedHeight * safeScale - safeViewportHeight) / 2),
  };
}

export function clampImageTranslation(value: number, bound: number): number {
  "worklet";
  return Math.max(-bound, Math.min(bound, value));
}

export function doubleTapImageTranslation(viewportSize: number, point: number, scale: number, bound: number): number {
  "worklet";
  return clampImageTranslation((viewportSize / 2 - point) * (Math.max(1, scale) - 1), bound);
}
