import type { AppSettings } from "@snezhok/contracts";

export function scaledFont(size: number, scale: number): number {
  const safeScale = Number.isFinite(scale) ? Math.max(0.8, Math.min(1.5, scale)) : 1;
  return Math.round(size * safeScale * 10) / 10;
}

export function densityValue(density: AppSettings["density"], comfortable: number, compact: number): number {
  return density === "compact" ? compact : comfortable;
}

export function safeBubbleRadius(value: number): number {
  if (!Number.isFinite(value)) return 16;
  return Math.max(0, Math.min(24, Math.round(value)));
}
