export function authenticatedMediaFilename(cacheKey: string, uri: string, mimeType?: string | null): string {
  const safeKey = cacheKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 72) || "media";
  return `${safeKey}-${stableHash(uri)}.${extensionForMimeType(mimeType)}`;
}

export function extensionForMimeType(mimeType?: string | null): string {
  const normalized = mimeType?.toLowerCase().split(";")[0]?.trim();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "audio/ogg") return "ogg";
  if (normalized === "audio/mpeg") return "mp3";
  if (normalized === "audio/mp4" || normalized === "video/mp4") return "mp4";
  return "bin";
}

function stableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
