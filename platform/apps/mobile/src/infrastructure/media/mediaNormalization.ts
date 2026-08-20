import type { UploadInput } from "../../types";

export function kindFromMimeType(mimeType: string | undefined): UploadInput["kind"] {
  if (mimeType?.startsWith("audio/")) return "audio";
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("image/")) return "image";
  return "document";
}

export function mimeTypeFor(filename: string, video: boolean): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (video) {
    if (extension === "mov") return "video/quicktime";
    if (extension === "webm") return "video/webm";
    if (extension === "mkv") return "video/x-matroska";
    return "video/mp4";
  }
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "heic" || extension === "heif") return "image/heic";
  return "image/jpeg";
}
