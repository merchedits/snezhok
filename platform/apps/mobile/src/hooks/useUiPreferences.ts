import { useMemo } from "react";

import { scaledFont } from "../lib/uiPreferences";
import { useAppStore } from "../store/useAppStore";

export function useUiPreferences() {
  const fontScale = useAppStore((state) => state.settings.fontScale);
  return useMemo(() => ({
    fontScale,
    density: "comfortable" as const,
    bubbleRadius: 18,
    font: (size: number) => scaledFont(size, fontScale),
    dense: (comfortable: number, _compact: number) => comfortable,
  }), [fontScale]);
}
