import { useColorScheme } from "react-native";

import type { AppSettings } from "@snezhok/contracts";

import { useAppStore } from "../store/useAppStore";
import { createPalette } from "../theme";

const accents: Record<AppSettings["accent"], string> = {
  blue: "#2aabee",
  green: "#36aa6d",
  purple: "#8b6de8",
  orange: "#e98b3f",
  red: "#df5964",
};

export function usePalette() {
  const system = useColorScheme();
  const settings = useAppStore((state) => state.settings);
  const scheme = settings.theme === "system" ? system : settings.theme;
  return createPalette(scheme, accents[settings.accent]);
}
