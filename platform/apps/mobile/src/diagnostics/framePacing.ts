export interface FramePacingResult {
  frames: number;
  averageFps: number;
  p95FrameMs: number;
  jankyFrames: number;
}

export function summarizeFrameDeltas(deltas: number[]): FramePacingResult {
  const valid = deltas.filter((delta) => Number.isFinite(delta) && delta > 0 && delta < 1_000).sort((left, right) => left - right);
  if (!valid.length) return { frames: 0, averageFps: 0, p95FrameMs: 0, jankyFrames: 0 };
  const average = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  return {
    frames: valid.length,
    averageFps: Math.round((1_000 / average) * 10) / 10,
    p95FrameMs: Math.round(valid[Math.min(valid.length - 1, Math.floor(valid.length * 0.95))]! * 10) / 10,
    jankyFrames: valid.filter((delta) => delta > 25).length,
  };
}

export function measureFramePacing(durationMs = 1_500): Promise<FramePacingResult> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    const startedAt = performance.now();
    let previous = startedAt;
    const frame = (now: number) => {
      deltas.push(now - previous);
      previous = now;
      if (now - startedAt >= durationMs) {
        resolve(summarizeFrameDeltas(deltas.slice(1)));
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
