const HTTPS_URL = /https:\/\/[^\s<>{}\[\]"']+/iu;

export function firstPreviewUrl(text: string): string | null {
  const raw = HTTPS_URL.exec(text)?.[0]?.replace(/[),.!?:;]+$/u, "");
  if (!raw || raw.length > 2_048) return null;
  try { const url = new URL(raw); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
}
