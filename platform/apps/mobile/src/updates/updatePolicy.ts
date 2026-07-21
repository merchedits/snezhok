import type { AndroidReleaseManifest } from "../types";

export function isNewerRelease(releaseVersionCode: number, currentVersionCode: number) {
  return releaseVersionCode > currentVersionCode;
}

export function isRequired(manifest: Pick<AndroidReleaseManifest, "mandatory" | "minimumVersionCode">, currentVersionCode: number) {
  return manifest.mandatory || currentVersionCode < manifest.minimumVersionCode;
}

export function blocksApplicationForUpdate(required: boolean, phase: string): boolean {
  return required && ["available", "downloading", "ready", "error"].includes(phase);
}

export function arrayBufferToHex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function monotonicDownloadProgress(bytesWritten: number, expectedBytes: number, previousProgress: number) {
  if (!Number.isFinite(bytesWritten) || !Number.isFinite(expectedBytes) || expectedBytes <= 0) return previousProgress;
  const measured = Math.max(0, Math.min(1, bytesWritten / expectedBytes));
  return Math.max(previousProgress, measured);
}
