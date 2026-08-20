import type { DiagnosticReport } from "@snezhok/contracts";

export interface DiagnosticDeliveryDependencies {
  readWatermark: () => Promise<number>;
  writeWatermark: (timestamp: number) => Promise<void>;
  buildReport: (afterExclusive: number) => Promise<DiagnosticReport>;
  sendReport: (report: DiagnosticReport) => Promise<void>;
}

/**
 * Delivers only new warning/error evidence. The server deduplicates event IDs,
 * so a timeout after commit is safe to retry before advancing the watermark.
 */
export async function deliverPendingDiagnostics(dependencies: DiagnosticDeliveryDependencies): Promise<number> {
  const watermark = Math.max(0, await dependencies.readWatermark());
  const report = await dependencies.buildReport(watermark);
  const newest = report.events.reduce((latest, event) => Math.max(latest, event.at), watermark);
  if (newest === watermark) return watermark;
  const reportable = report.events.filter((event) => event.level === "warn" || event.level === "error");
  if (reportable.length) await dependencies.sendReport({ ...report, events: reportable });
  await dependencies.writeWatermark(newest);
  return newest;
}
