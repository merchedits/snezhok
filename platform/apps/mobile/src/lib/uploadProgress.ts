export function uploadPercent(sent: number, expected: number): number {
  if (!Number.isFinite(sent) || !Number.isFinite(expected) || expected <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((sent / expected) * 100)));
}
