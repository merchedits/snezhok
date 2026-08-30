import type { AppSettings } from "@snezhok/contracts";

const MINIMUM_LEVEL = 0.06;

export function recordingSourceForMicrophone(mode: AppSettings["microphoneMode"]): "default" | "mic" | "voice_communication" {
  if (mode === "phone") return "mic";
  if (mode === "speakerphone") return "voice_communication";
  return "default";
}

export function routeThroughEarpieceForMicrophone(mode: AppSettings["microphoneMode"]): boolean | undefined {
  if (mode === "system") return undefined;
  return mode === "phone";
}

/** Convert the recorder's logarithmic dBFS meter into a stable 0..1 visual level. */
export function recordingMeterLevel(metering: number | undefined): number {
  if (metering === undefined || !Number.isFinite(metering)) return MINIMUM_LEVEL;
  const normalized = Math.max(0, Math.min(1, (metering + 60) / 60));
  return Math.max(MINIMUM_LEVEL, Math.pow(normalized, 1.55));
}

/** Add a live sample with light smoothing while retaining only the visible history. */
export function appendRecordingLevel(levels: number[], metering: number | undefined, limit = 38): number[] {
  const raw = recordingMeterLevel(metering);
  const previous = levels.at(-1) ?? raw;
  const smoothed = raw > previous ? raw * 0.72 + previous * 0.28 : raw * 0.42 + previous * 0.58;
  return [...levels, smoothed].slice(-Math.max(1, limit));
}

export function appendRecordingWaveformSample(samples: number[], metering: number | undefined, limit = 512): number[] {
  const next = [...samples, recordingMeterLevel(metering)];
  if (next.length <= limit) return next;
  const compacted: number[] = [];
  for (let index = 0; index < next.length; index += 2) compacted.push(Math.max(next[index] ?? 0, next[index + 1] ?? 0));
  return compacted;
}

export function finalizeRecordingWaveform(samples: readonly number[], bins = 100): number[] {
  const count = Math.max(1, Math.floor(bins));
  if (!samples.length) return Array<number>(count).fill(6);
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * samples.length / count);
    const end = Math.max(start + 1, Math.ceil((index + 1) * samples.length / count));
    let peak = 0;
    for (let cursor = start; cursor < Math.min(samples.length, end); cursor += 1) peak = Math.max(peak, samples[cursor] ?? 0);
    return Math.max(0, Math.min(100, Math.round(peak * 100)));
  });
}
