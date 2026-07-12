import type { Attachment, UploadQuality } from "@snezhok/contracts";

export function attachmentKind(file: File): Attachment["kind"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

export async function prepareMedia(file: File, quality: UploadQuality): Promise<File> {
  if (!file.type.startsWith("image/") || quality === "original" || file.type === "image/gif") return file;

  const bitmap = await createImageBitmap(file);
  const limits: Record<Exclude<UploadQuality, "original">, { edge: number; quality: number }> = {
    "data-saver": { edge: 1280, quality: 0.68 },
    auto: { edge: 1920, quality: 0.82 },
    high: { edge: 3840, quality: 0.9 },
  };
  const profile = limits[quality];
  const scale = Math.min(1, profile.edge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", profile.quality));
  if (!blob || blob.size >= file.size) return file;
  const basename = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${basename}.webp`, { type: "image/webp", lastModified: file.lastModified });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function createObjectUrl(file: Blob): { url: string; revoke: () => void } {
  const url = URL.createObjectURL(file);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}
