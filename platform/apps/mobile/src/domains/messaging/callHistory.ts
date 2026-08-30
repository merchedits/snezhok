export interface CallHistoryEvent { status: "missed" | "completed"; durationMs: number }

export function parseCallHistoryEvent(text: string): CallHistoryEvent | null {
  try {
    const value = JSON.parse(text) as { v?: unknown; type?: unknown; status?: unknown; durationMs?: unknown };
    if (value.v !== 1 || value.type !== "call" || (value.status !== "missed" && value.status !== "completed") || typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs)) return null;
    return { status: value.status, durationMs: Math.max(0, value.durationMs) };
  } catch { return null; }
}

export function callDurationLabel(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
