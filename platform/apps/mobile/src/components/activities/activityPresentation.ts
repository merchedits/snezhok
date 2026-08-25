import type { CooperativeActivityType } from "@snezhok/contracts";

const persistentCollections = new Set<CooperativeActivityType>(["movie-list", "ideas-jar"]);

export function isPersistentCollection(type: CooperativeActivityType): boolean {
  return persistentCollections.has(type);
}

export function canTerminateActivity(type: CooperativeActivityType, state: string): boolean {
  return !isPersistentCollection(type) && !["completed", "locked", "declined", "cancelled", "expired"].includes(state);
}

export function distinctActivityCopy(label: string, primary: string, fallback = ""): string {
  const candidate = primary.trim() || fallback.trim();
  return normalizeCopy(candidate) === normalizeCopy(label) ? "" : candidate;
}

export function persistentCollectionStatus(language: "ru" | "en"): string {
  return language === "ru" ? "Общий список" : "Shared list";
}

function normalizeCopy(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
