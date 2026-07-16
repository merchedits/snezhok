import { requireOptionalNativeModule } from "expo-modules-core";

export interface NativeExitReason {
  reason: "exit-self" | "signaled" | "low-memory" | "java-crash" | "native-crash" | "anr" | "initialization-failure" | "permission-change" | "excessive-resource-usage" | "user-requested" | "user-stopped" | "dependency-died" | "other" | "freezer" | "package-state-change" | "package-updated" | "unknown";
  reasonCode: number;
  timestamp: number;
  importance: number;
  pssKb: number;
  rssKb: number;
  description: string | null;
}

interface SnezhokDiagnosticsNativeModule {
  installCrashHandler(): boolean;
  consumeLastNativeCrash(): Promise<string | null>;
  getHistoricalExitReasons(limit: number): Promise<NativeExitReason[]>;
}

const nativeModule = requireOptionalNativeModule<SnezhokDiagnosticsNativeModule>("SnezhokDiagnostics");

export function installNativeCrashCapture(): boolean {
  return nativeModule?.installCrashHandler() ?? false;
}

export async function consumeLastNativeCrash(): Promise<string | null> {
  return nativeModule?.consumeLastNativeCrash() ?? null;
}

export async function historicalExitReasons(limit = 8): Promise<NativeExitReason[]> {
  return nativeModule?.getHistoricalExitReasons(limit) ?? [];
}
