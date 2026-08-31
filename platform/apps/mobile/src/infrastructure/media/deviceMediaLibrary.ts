import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";

import type { UploadInput } from "../../types";
import { kindFromMimeType, mimeTypeFor } from "./mediaNormalization";

export interface DeviceMediaAsset {
  id: string;
  filename: string | null;
  mediaType: "image" | "video";
  duration: number | null;
  width: number;
  height: number;
}

export type DeviceMediaResult<T> =
  | { status: "selected"; value: T }
  | { status: "cancelled" }
  | { status: "permission-denied" };

const MAX_RECENT_ASSETS = 72;

/** Native picker/library boundary. UI only receives normalized application data. */
class DeviceMediaLibrary {
  private recent: DeviceMediaAsset[] = [];

  cachedRecent(): DeviceMediaAsset[] {
    return this.recent;
  }

  async recentAssets(imagesOnly: boolean): Promise<DeviceMediaResult<DeviceMediaAsset[]>> {
    const permission = await MediaLibrary.requestPermissionsAsync(false, ["photo", "video"]);
    if (!permission.granted) return { status: "permission-denied" };
    const rows = await new MediaLibrary.Query()
      .within(MediaLibrary.AssetField.MEDIA_TYPE, imagesOnly ? [MediaLibrary.MediaType.IMAGE] : [MediaLibrary.MediaType.IMAGE, MediaLibrary.MediaType.VIDEO])
      // DATE_TAKEN is legitimately null for many Android PNGs and screenshots.
      // MediaStore modification time reliably keeps newly captured/imported
      // assets at the front instead of silently pushing them beyond our limit.
      .orderBy({ key: MediaLibrary.AssetField.MODIFICATION_TIME, ascending: false })
      .limit(MAX_RECENT_ASSETS)
      .exeForMetadata();
    this.recent = rows.flatMap((asset) => {
      const mediaType = asset.mediaType === MediaLibrary.MediaType.IMAGE ? "image" : asset.mediaType === MediaLibrary.MediaType.VIDEO ? "video" : null;
      return mediaType ? [{ id: asset.id, filename: asset.filename ?? null, mediaType, duration: asset.duration, width: asset.width ?? 0, height: asset.height ?? 0 }] : [];
    });
    return { status: "selected", value: this.recent };
  }

  async originalFile(): Promise<DeviceMediaResult<{ inputs: UploadInput[]; messageKind: "file" }>> {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    const asset = result.assets?.[0];
    if (!asset) return { status: "cancelled" };
    return {
      status: "selected",
      value: {
        messageKind: "file",
        inputs: [{
          uri: asset.uri,
          previewUri: asset.uri,
          filename: asset.name,
          mimeType: asset.mimeType ?? "application/octet-stream",
          kind: kindFromMimeType(asset.mimeType),
          quality: "original",
          purpose: "standard",
          stripLocation: false,
        }],
      },
    };
  }

  async cameraPhoto(quality: "auto" | "high"): Promise<DeviceMediaResult<{ inputs: UploadInput[]; messageKind: "media" }>> {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { status: "permission-denied" };
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: quality === "high" ? 1 : 0.86, exif: false });
    const asset = result.assets?.[0];
    if (!asset) return { status: "cancelled" };
    const filename = asset.fileName ?? `snezhok-camera-${Date.now()}.jpg`;
    return {
      status: "selected",
      value: {
        messageKind: "media",
        inputs: [{
          uri: asset.uri,
          previewUri: asset.uri,
          filename,
          mimeType: asset.mimeType ?? mimeTypeFor(filename, false),
          kind: "image",
          quality,
          purpose: "standard",
          stripLocation: true,
          sourceWidth: asset.width,
          sourceHeight: asset.height,
        }],
      },
    };
  }

  async resolveAssets(assetIds: string[], quality: "auto" | "high"): Promise<UploadInput[]> {
    // Resolve sequentially. Several simultaneous MediaStore descriptors can
    // exhaust the small native resource budget on low-memory Android devices.
    const infos: Array<{ id: string; info: Awaited<ReturnType<MediaLibrary.Asset["getInfo"]>> }> = [];
    for (const id of assetIds) infos.push({ id, info: await new MediaLibrary.Asset(id).getInfo() });
    return infos.map(({ id, info }) => {
      const cached = this.recent.find((asset) => asset.id === id);
      const filename = info.filename || cached?.filename || `media-${Date.now()}`;
      const video = info.mediaType === MediaLibrary.MediaType.VIDEO;
      return {
        uri: info.uri,
        // MediaStore filesystem paths can be unreadable under scoped storage.
        // The asset id is the durable content:// handle already used by the
        // gallery grid and can be decoded immediately without a server roundtrip.
        previewUri: info.id,
        filename,
        mimeType: mimeTypeFor(filename, video),
        kind: video ? "video" : "image",
        quality,
        purpose: "standard",
        sourceWidth: info.width ?? cached?.width,
        sourceHeight: info.height ?? cached?.height,
      };
    });
  }

  reset(): void {
    this.recent = [];
  }
}

export const deviceMediaLibrary = new DeviceMediaLibrary();
