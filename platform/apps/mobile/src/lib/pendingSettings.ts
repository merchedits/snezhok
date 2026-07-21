import type { AppSettings } from "@snezhok/contracts";

export type PendingSettingsPatch = Partial<AppSettings>;

export function mergePendingSettings(current: PendingSettingsPatch, patch: PendingSettingsPatch): PendingSettingsPatch {
  return { ...current, ...patch };
}

/**
 * Removes only values acknowledged by the request that just completed. A
 * newer local tap on the same key therefore remains durable for the next sync.
 */
export function acknowledgePendingSettings(
  current: PendingSettingsPatch,
  requested: PendingSettingsPatch,
): PendingSettingsPatch {
  const remaining = { ...current };
  for (const key of Object.keys(requested) as Array<keyof AppSettings>) {
    if (Object.is(current[key], requested[key])) delete remaining[key];
  }
  return remaining;
}

export function hasPendingSettings(patch: PendingSettingsPatch): boolean {
  return Object.keys(patch).length > 0;
}
