import { randomInt } from "node:crypto";
import type { CooperativeActivityType } from "@snezhok/contracts";
import { blitzPrompts, drawWords, songPrompts, tinyQuests } from "./promptCatalogs/activities.js";
import { questionCatalog } from "./promptCatalogs/questions.js";
import type { LocalizedText } from "./promptCatalogs/types.js";

export { blitzPrompts, drawWords, questionCatalog, songPrompts, tinyQuests };
export type { ChoicePrompt, LocalizedText } from "./promptCatalogs/types.js";

export const huntColors = [
  { id: "blue", hex: "#4F86F7", name: { ru: "Синий", en: "Blue" } },
  { id: "orange", hex: "#FF8A3D", name: { ru: "Оранжевый", en: "Orange" } },
  { id: "green", hex: "#59C884", name: { ru: "Зелёный", en: "Green" } },
  { id: "pink", hex: "#F47783", name: { ru: "Розовый", en: "Pink" } },
  { id: "purple", hex: "#A574E8", name: { ru: "Фиолетовый", en: "Purple" } },
  { id: "yellow", hex: "#F4CC58", name: { ru: "Жёлтый", en: "Yellow" } },
] as const;

export function initialActivityConfiguration(
  type: CooperativeActivityType,
  options: Record<string, unknown>,
  participantIds: string[],
  recentConfigurations: readonly Record<string, unknown>[] = [],
) {
  switch (type) {
    case "question": {
      const category = typeof options.category === "string" && questionCatalog[options.category] ? options.category : "random";
      const pool = questionPool(category, options.matureAllowed === true);
      return { config: { prompt: pickFreshLocalized(pool, recentConfigurations.map((config) => config.prompt)), category, secret: options.secret !== false }, privateByUser: {} };
    }
    case "blitz": {
      const count = integerBetween(options.count, 5, 10, 8);
      const recentIds = new Set(
        recentConfigurations
          .flatMap((config) => (Array.isArray(config.prompts) ? config.prompts : []))
          .map((prompt) => (prompt && typeof prompt === "object" ? (prompt as Record<string, unknown>).id : undefined))
          .filter((id): id is string => typeof id === "string"),
      );
      const fresh = blitzPrompts.filter((prompt) => !recentIds.has(prompt.id));
      return { config: { prompts: sample(fresh.length >= count ? fresh : blitzPrompts, count) }, privateByUser: {} };
    }
    case "tiny-quest": return { config: { prompt: pickFreshLocalized(tinyQuests, recentConfigurations.map((config) => config.prompt)) }, privateByUser: {} };
    case "color-hunt": {
      const colors = sample(huntColors, Math.max(2, participantIds.length));
      return { config: { target: 9 }, privateByUser: Object.fromEntries(participantIds.map((id, index) => [id, { color: colors[index] }])) };
    }
    case "song-exchange": return { config: { prompt: pickFreshLocalized(songPrompts, recentConfigurations.map((config) => config.prompt)) }, privateByUser: {} };
    case "draw-guess": {
      const drawerId = participantIds[randomInt(participantIds.length)]!;
      return { config: { drawerId }, privateByUser: { [drawerId]: { word: pick(drawWords) } } };
    }
    case "memory-capsule": {
      const months = integerBetween(options.months, 1, 6, 1);
      return { config: { months }, privateByUser: {} };
    }
    case "movie-list": return { config: { title: { ru: "Наши фильмы", en: "Our movies" } }, privateByUser: {} };
    case "ideas-jar": return { config: { title: { ru: "Банка идей", en: "Ideas jar" } }, privateByUser: {} };
    case "milestone": return { config: { milestone: options.milestone ?? "first-activity" }, privateByUser: {} };
  }
}

export function questionPool(category: string, matureAllowed: boolean): LocalizedText[] {
  if (category !== "random" && questionCatalog[category]) return [...questionCatalog[category]!];
  return Object.entries(questionCatalog).filter(([name]) => matureAllowed || (name !== "romantic" && name !== "nsfw")).flatMap(([, prompts]) => prompts);
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)]!;
}

function pickFreshLocalized(items: readonly LocalizedText[], recentValues: readonly unknown[]): LocalizedText {
  const recent = new Set(recentValues.map(localizedKey).filter((key): key is string => Boolean(key)));
  const fresh = items.filter((item) => {
    const key = localizedKey(item);
    return !key || !recent.has(key);
  });
  return pick(fresh.length ? fresh : items);
}

function localizedKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const prompt = value as Record<string, unknown>;
  return typeof prompt.ru === "string" && typeof prompt.en === "string" ? `${prompt.ru}\u0000${prompt.en}` : null;
}

function sample<T>(items: readonly T[], count: number): T[] {
  const remaining = [...items];
  const result: T[] = [];
  while (remaining.length && result.length < count) result.push(remaining.splice(randomInt(remaining.length), 1)[0]!);
  return result;
}

function integerBetween(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
