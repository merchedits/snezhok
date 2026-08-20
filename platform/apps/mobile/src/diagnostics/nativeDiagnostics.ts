import AsyncStorage from "@react-native-async-storage/async-storage";

import { consumeLastNativeCrash, historicalExitReasons, installNativeCrashCapture } from "../../modules/snezhok-native-diagnostics";
import { recordDiagnostic } from "./diagnostics";
import { nativeExitSeverity, parseNativeCrashSummary } from "./nativeExitPolicy";

const LAST_EXIT_TIMESTAMP_KEY = "@snezhok/diagnostics/native-exit-timestamp/v1";
const FIRST_IMPORT_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** Install synchronously before application initialization does meaningful work. */
export function installNativeDiagnostics(): void {
  installNativeCrashCapture();
}

/** Import previous-process evidence once, after the JS diagnostics buffer is ready. */
export async function ingestNativeDiagnostics(): Promise<void> {
  const [nativeCrash, exitReasons, storedTimestamp] = await Promise.all([
    consumeLastNativeCrash().catch(() => null),
    historicalExitReasons(12).catch(() => []),
    AsyncStorage.getItem(LAST_EXIT_TIMESTAMP_KEY).catch(() => null),
  ]);
  const previousTimestamp = Number(storedTimestamp) || 0;
  const cutoff = previousTimestamp || Date.now() - FIRST_IMPORT_WINDOW_MS;
  const summary = parseNativeCrashSummary(nativeCrash);
  if (summary && summary.recordedAt > cutoff) {
    recordDiagnostic("error", "native-crash", "Previous process ended with an uncaught native exception", {
      recordedAt: summary.recordedAt,
      thread: summary.thread,
      type: summary.type,
      frame: summary.frame,
    });
  }

  const unseen = exitReasons
    .filter((exit) => exit.timestamp > cutoff && nativeExitSeverity(exit.reason))
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-4);
  for (const exit of unseen) {
    recordDiagnostic(nativeExitSeverity(exit.reason)!, "process-exit", `Previous Android process exit: ${exit.reason}`, {
      timestamp: exit.timestamp,
      reasonCode: exit.reasonCode,
      importance: exit.importance,
      pssKb: exit.pssKb,
      rssKb: exit.rssKb,
    });
  }

  const newestTimestamp = exitReasons.reduce((latest, exit) => Math.max(latest, exit.timestamp), previousTimestamp);
  if (newestTimestamp > previousTimestamp) {
    await AsyncStorage.setItem(LAST_EXIT_TIMESTAMP_KEY, String(newestTimestamp)).catch(() => undefined);
  }
}
