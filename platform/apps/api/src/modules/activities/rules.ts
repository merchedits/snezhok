export function normalizeGuess(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function combinedRating(ratings: Record<string, unknown>) {
  const values = Object.values(ratings).filter((rating): rating is number => typeof rating === "number" && Number.isFinite(rating) && rating >= 1 && rating <= 10);
  if (!values.length) return null;
  return Math.round((values.reduce((total, rating) => total + rating, 0) / values.length) * 10) / 10;
}

export function memoryRevealDate(now: Date, months: number) {
  const result = new Date(now);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + Math.max(1, Math.min(6, Math.trunc(months))));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

export function validSongUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length <= 253;
  } catch {
    return false;
  }
}

export function isYandexMusicUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLocaleLowerCase("en-US");
    return host === "music.yandex.ru" || host.endsWith(".music.yandex.ru") || host === "music.yandex.com" || host.endsWith(".music.yandex.com");
  } catch {
    return false;
  }
}

export function parseDrawingStrokes(value: unknown, width: number, height: number): number[][][] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) return null;
  let points = 0;
  const strokes: number[][][] = [];
  for (const stroke of value) {
    if (!Array.isArray(stroke) || stroke.length < 2 || stroke.length > 500) return null;
    const next: number[][] = [];
    for (const point of stroke) {
      if (!Array.isArray(point) || point.length !== 2) return null;
      const [x, y] = point;
      if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > width || typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > height) return null;
      next.push([x, y]);
      points += 1;
      if (points > 3_000) return null;
    }
    strokes.push(next);
  }
  return strokes;
}

export function colorHuntBatchLimit(target: number, count: number) {
  return Math.max(0, Math.min(9, Math.trunc(target) - Math.trunc(count)));
}
