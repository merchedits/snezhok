export const MAIN_TABS = ["chats", "servers", "profile", "settings"] as const;

export type MainTab = (typeof MAIN_TABS)[number];

export function mainTabIndex(tab: MainTab): number {
  return MAIN_TABS.indexOf(tab);
}

export function mainTabDirection(from: MainTab, to: MainTab): -1 | 0 | 1 {
  return Math.sign(mainTabIndex(to) - mainTabIndex(from)) as -1 | 0 | 1;
}
