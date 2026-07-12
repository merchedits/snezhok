import type { AndroidReleaseManifest } from "../types";

export function isNewerRelease(releaseVersionCode: number, currentVersionCode: number) {
  return releaseVersionCode > currentVersionCode;
}

export function isRequired(manifest: Pick<AndroidReleaseManifest, "mandatory" | "minimumVersionCode">, currentVersionCode: number) {
  return manifest.mandatory || currentVersionCode < manifest.minimumVersionCode;
}

export function arrayBufferToHex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
