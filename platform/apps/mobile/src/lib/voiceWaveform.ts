const fallback = [24, 44, 31, 68, 39, 78, 48, 61, 35, 72, 42, 55, 30, 64, 46, 76, 38, 58, 27, 70];

/** Downsamples server peaks into compact, consistently legible Telegram-style bars. */
export function voiceWaveformBars(waveform: number[] | undefined, targetBars = 40): number[] {
  const source = waveform?.length ? waveform.map((value) => clamp(value)) : fallback;
  const count = Math.max(1, Math.min(targetBars, source.length));
  const bars: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const from = Math.floor(index * source.length / count);
    const to = Math.max(from + 1, Math.floor((index + 1) * source.length / count));
    let peak = 0;
    for (let sourceIndex = from; sourceIndex < to; sourceIndex += 1) peak = Math.max(peak, source[sourceIndex] ?? 0);
    bars.push(4 + Math.round(peak / 100 * 16));
  }
  return bars;
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}
