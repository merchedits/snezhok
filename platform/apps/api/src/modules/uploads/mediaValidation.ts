import type { Attachment } from "@snezhok/contracts";
import { AppError } from "../../lib/errors.js";

const MEDIA_LIMITS: Record<Attachment["kind"], number> = {
  image: 100 * 1024 * 1024,
  audio: 512 * 1024 * 1024,
  video: 2 * 1024 * 1024 * 1024,
  document: 2 * 1024 * 1024 * 1024,
};

type Purpose = "standard" | "voice" | "video-note";

export function validateUploadDeclaration(input: { kind: Attachment["kind"]; purpose: Purpose; mimeType: string; bytes: number; filename: string }, configuredMaxBytes: number): void {
  const limit = Math.min(configuredMaxBytes, MEDIA_LIMITS[input.kind]);
  if (!Number.isSafeInteger(input.bytes) || input.bytes <= 0) throw new AppError(400, "EMPTY_UPLOAD", "Upload must contain at least one byte");
  if (input.bytes > limit) throw new AppError(413, "UPLOAD_TOO_LARGE", `Upload exceeds the ${formatLimit(limit)} limit for ${input.kind} files`);
  if (/[/\\\u0000-\u001f\u007f]/.test(input.filename)) throw new AppError(400, "INVALID_FILENAME", "Filename contains unsupported characters");
  if (!/^[\w.+-]+\/[\w.+-]+$/i.test(input.mimeType)) throw new AppError(400, "INVALID_MIME_TYPE", "Invalid media type");
  assertMimeMatches(input.kind, input.purpose, input.mimeType, "declared");
}

export function validateDetectedMedia(kind: Attachment["kind"], purpose: Purpose, detectedMimeType: string): void {
  assertMimeMatches(kind, purpose, detectedMimeType, "detected");
}

function assertMimeMatches(kind: Attachment["kind"], purpose: Purpose, mimeType: string, source: "declared" | "detected"): void {
  if (kind === "document") return;
  const compatible = purpose === "voice"
    ? mimeType.startsWith("audio/") || mimeType.startsWith("video/")
    : purpose === "video-note"
      ? mimeType.startsWith("video/")
      : mimeType.startsWith(`${kind}/`);
  if (!compatible) throw new AppError(415, "MEDIA_TYPE_MISMATCH", `The ${source} file type does not match the requested ${kind} upload`);
}

function formatLimit(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024 ? `${Math.floor(bytes / 1024 / 1024 / 1024)} GB` : `${Math.floor(bytes / 1024 / 1024)} MB`;
}

export const mediaUploadLimits = MEDIA_LIMITS;
