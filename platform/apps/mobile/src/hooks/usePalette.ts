import { useMemo } from "react";
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
  // Palette consumers are present in every list row. Selecting the complete
  // settings object made all of them rerender for unrelated audio/data changes.
  const theme = useAppStore((state) => state.settings.theme);
  const accent = useAppStore((state) => state.settings.accent);
  const highContrast = useAppStore((state) => state.settings.highContrast);
  const scheme = theme === "system" ? system : theme;
  return useMemo(() => createPalette(scheme, accents[accent], highContrast), [accent, highContrast, scheme]);
}
