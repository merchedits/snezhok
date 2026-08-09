import { useMemo } from "react";
import { useColorScheme } from "react-native";

import { useAppStore } from "../store/useAppStore";
import { createPalette } from "../theme";

export function usePalette() {
  const system = useColorScheme();
  // Palette consumers are present in every list row. Selecting the complete
  // settings object made all of them rerender for unrelated audio/data changes.
  const theme = useAppStore((state) => state.settings.theme);
  const highContrast = useAppStore((state) => state.settings.highContrast);
  const scheme = theme === "system" ? system : theme;
  return useMemo(() => createPalette(scheme, highContrast), [highContrast, scheme]);
}
