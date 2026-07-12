import { lstat } from "node:fs/promises";
import path from "node:path";

export function isSafeLegacyStoredName(storedName: string) {
  return Boolean(storedName && path.basename(storedName) === storedName && storedName !== "." && storedName !== "..");
}

export async function safeLegacyFile(root: string, storedName: string) {
  if (!isSafeLegacyStoredName(storedName)) return null;
  const resolvedRoot = path.resolve(root); const candidate = path.resolve(resolvedRoot, storedName);
  if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  const info = await lstat(candidate).catch(() => null);
  return info?.isFile() && !info.isSymbolicLink() ? candidate : null;
}
