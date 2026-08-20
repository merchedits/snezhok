import type { NativeExitReason } from "../../modules/snezhok-native-diagnostics";

export type NativeExitSeverity = "warn" | "error";

export function nativeExitSeverity(reason: NativeExitReason["reason"]): NativeExitSeverity | null {
  switch (reason) {
    case "java-crash":
    case "native-crash":
    case "anr":
    case "initialization-failure":
    case "signaled":
      return "error";
    case "low-memory":
    case "excessive-resource-usage":
    case "dependency-died":
      return "warn";
    default:
      return null;
  }
}

export interface NativeCrashSummary {
  recordedAt: number;
  thread: string;
  type: string;
  frame: string | null;
}

/**
 * Native exception text and stack frames may contain user-authored values.
 * Diagnostics retain only bounded structural metadata to honor the promise
 * that reports never include message contents.
 */
export function parseNativeCrashSummary(raw: string | null): NativeCrashSummary | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!Number.isFinite(value.recordedAt) || typeof value.thread !== "string" || typeof value.type !== "string") return null;
    return {
      recordedAt: Number(value.recordedAt),
      thread: value.thread.slice(0, 80),
      type: value.type.slice(0, 160),
      frame: typeof value.frame === "string" ? value.frame.slice(0, 240) : null,
    };
  } catch {
    return null;
  }
}
