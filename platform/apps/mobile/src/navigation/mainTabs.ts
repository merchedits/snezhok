import { productCapabilities } from "../config/productCapabilities";

export const ALL_MAIN_TABS = ["chats", "servers", "profile", "settings"] as const;

export type MainTab = (typeof ALL_MAIN_TABS)[number];

export const MAIN_TABS: readonly MainTab[] = ALL_MAIN_TABS.filter(
  (tab) => tab !== "servers" || productCapabilities.servers,
);

export function mainTabIndex(tab: MainTab): number {
  return MAIN_TABS.indexOf(tab);
}

export function mainTabDirection(from: MainTab, to: MainTab): -1 | 0 | 1 {
  return Math.sign(mainTabIndex(to) - mainTabIndex(from)) as -1 | 0 | 1;
}

export function mainTabTransition(from: MainTab, to: MainTab) {
  return {
    from,
    to,
    direction: mainTabDirection(from, to),
  } as const;
}

export function visitMainTab(visited: ReadonlySet<MainTab>, tab: MainTab): ReadonlySet<MainTab> {
  if (visited.has(tab)) return visited;
  const next = new Set(visited);
  next.add(tab);
  return next;
}
