import { useMemo } from "react";
import { useColorScheme } from "react-native";

import type { AppSettings } from "@snezhok/contracts";

import { useAppStore } from "../store/useAppStore";
import { createPalette } from "../theme";

const accents: Record<AppSettings["accent"], string> = {
  blue: "#3F6FE5",
  green: "#39A86B",
  purple: "#8A63D2",
  orange: "#E77C33",
  red: "#D94A57",
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
