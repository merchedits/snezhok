import { requireOptionalNativeModule } from "expo-modules-core";

export interface CompressedImage {
  uri: string;
  width: number;
  height: number;
}

interface SnezhokMediaCompressorNativeModule {
  compressJpeg(uri: string, maximumLongEdge: number, quality: number): Promise<CompressedImage>;
}

const nativeModule = requireOptionalNativeModule<SnezhokMediaCompressorNativeModule>("SnezhokMediaCompressor");

export async function compressImageNative(uri: string, maximumLongEdge: number, quality: number): Promise<CompressedImage | null> {
  if (!nativeModule) return null;
  return nativeModule.compressJpeg(uri, maximumLongEdge, quality);
}
