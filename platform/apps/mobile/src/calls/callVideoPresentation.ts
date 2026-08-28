/** A muted/disabled publication must be unmounted. Keeping the last native
 * surface alive makes Android display a frozen final camera frame. */
export function shouldRenderCameraTrack(cameraEnabled: boolean, publicationMuted: boolean | undefined): boolean {
  return cameraEnabled && publicationMuted !== true;
}
