const PLACEHOLDER_WAVEFORM = [24, 44, 31, 68, 39, 78, 48, 61, 35, 72, 42, 55, 30, 64, 46, 76, 38, 58, 27, 70];

export const VOICE_WAVEFORM_BAR_COUNT = 48;
export const VOICE_WAVEFORM_HEIGHT = 24;

const MIN_BAR_HEIGHT = 4;
const MAX_BAR_HEIGHT = 20;
// Telegram clamps its normalization reference to 2,500 in signed 16-bit PCM.
// The API sends peaks as percentages of 32,767, so this is the same floor.
const MIN_REFERENCE_PEAK = 2_500 / 32_767 * 100;

/**
 * Converts API waveform peaks into Telegram-style pixel heights.
 *
 * The media worker supplies 0..100 full-scale PCM peaks. Telegram normalizes
 * those peaks against 1.8x the average, with a small absolute floor. This
 * keeps normal speech readable without turning digital silence into activity.
 */
export function voiceWaveformBars(
  waveform: readonly number[] | null | undefined,
  targetBars = VOICE_WAVEFORM_BAR_COUNT,
): number[] {
  const count = clampBarCount(targetBars);
  const supplied = Array.isArray(waveform) && waveform.length > 0;
  const sanitized = (supplied ? waveform : PLACEHOLDER_WAVEFORM).map(clampPeak);
  const normalized = supplied ? normalizeLikeTelegram(sanitized) : sanitized;
  return resamplePeaks(normalized, count).map((peak) => (
    MIN_BAR_HEIGHT + Math.round(peak / 100 * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT))
  ));
}

/** Builds one low-allocation SVG path containing all waveform strokes. */
export function voiceWaveformPath(
  bars: readonly number[],
  width: number,
  height = VOICE_WAVEFORM_HEIGHT,
  strokeWidth = 2,
): string {
  if (bars.length === 0 || width <= 0 || height <= 0) return "";
  const centerY = height / 2;
  const usableWidth = Math.max(0, width - strokeWidth);
  const step = bars.length > 1 ? usableWidth / (bars.length - 1) : 0;
  let path = "";
  for (let index = 0; index < bars.length; index += 1) {
    const barHeight = Math.max(0, Math.min(height - strokeWidth, bars[index] ?? 0));
    const x = strokeWidth / 2 + step * index;
    const halfHeight = barHeight / 2;
    path += `${index === 0 ? "" : " "}M${compact(x)} ${compact(centerY - halfHeight)}V${compact(centerY + halfHeight)}`;
  }
  return path;
}

function normalizeLikeTelegram(peaks: readonly number[]): number[] {
  if (peaks.length === 0) return [];
  let sum = 0;
  for (const peak of peaks) sum += peak;
  const referencePeak = Math.max(MIN_REFERENCE_PEAK, sum * 1.8 / peaks.length);
  return peaks.map((peak) => Math.min(100, peak / referencePeak * 100));
}

function resamplePeaks(source: readonly number[], count: number): number[] {
  if (source.length === 0) return Array<number>(count).fill(0);
  if (source.length === 1) return Array<number>(count).fill(source[0] ?? 0);

  const result = new Array<number>(count);
  if (source.length >= count) {
    for (let index = 0; index < count; index += 1) {
      const from = Math.floor(index * source.length / count);
      const to = Math.max(from + 1, Math.floor((index + 1) * source.length / count));
      let peak = 0;
      for (let sourceIndex = from; sourceIndex < to; sourceIndex += 1) {
        peak = Math.max(peak, source[sourceIndex] ?? 0);
      }
      result[index] = peak;
    }
    return result;
  }

  // Older servers may return fewer bins. Interpolation avoids sparse or
  // repeated-looking bars while keeping the first and last peaks exact.
  for (let index = 0; index < count; index += 1) {
    const position = count === 1 ? 0 : index * (source.length - 1) / (count - 1);
    const left = Math.floor(position);
    const right = Math.min(source.length - 1, left + 1);
    const fraction = position - left;
    result[index] = (source[left] ?? 0) * (1 - fraction) + (source[right] ?? 0) * fraction;
  }
  return result;
}

function clampBarCount(value: number): number {
  if (!Number.isFinite(value)) return VOICE_WAVEFORM_BAR_COUNT;
  return Math.max(1, Math.min(100, Math.round(value)));
}

function clampPeak(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function compact(value: number): string {
  return String(Math.round(value * 100) / 100);
}
