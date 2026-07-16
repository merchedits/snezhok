import { useMemo } from "react";

import { densityValue, safeBubbleRadius, scaledFont } from "../lib/uiPreferences";
import { useAppStore } from "../store/useAppStore";

export function useUiPreferences() {
  const fontScale = useAppStore((state) => state.settings.fontScale);
  const density = useAppStore((state) => state.settings.density);
  const bubbleRadius = useAppStore((state) => state.settings.bubbleRadius);
  return useMemo(() => ({
    fontScale,
    density,
    bubbleRadius: safeBubbleRadius(bubbleRadius),
    font: (size: number) => scaledFont(size, fontScale),
    dense: (comfortable: number, compact: number) => densityValue(density, comfortable, compact),
  }), [bubbleRadius, density, fontScale]);
}
