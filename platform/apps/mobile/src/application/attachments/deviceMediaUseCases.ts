import {
  deviceMediaLibrary,
  type DeviceMediaAsset,
} from "../../infrastructure/media/deviceMediaLibrary";

export type { DeviceMediaAsset } from "../../infrastructure/media/deviceMediaLibrary";

export const deviceMediaUseCases = {
  cachedRecent: (): DeviceMediaAsset[] => deviceMediaLibrary.cachedRecent(),
  recentAssets: (imagesOnly: boolean) => deviceMediaLibrary.recentAssets(imagesOnly),
  pickOriginal: () => deviceMediaLibrary.originalFile(),
  capturePhoto: (quality: "auto" | "high") => deviceMediaLibrary.cameraPhoto(quality),
  resolveAssets: (assetIds: string[], quality: "auto" | "high") => deviceMediaLibrary.resolveAssets(assetIds, quality),
};
