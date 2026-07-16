import type { ColorSchemeName } from "react-native";

export type Palette = ReturnType<typeof createPalette>;

export function createPalette(scheme: ColorSchemeName, accent = "#2aabee", highContrast = false) {
  const dark = scheme === "dark";
  return {
    dark,
    background: dark ? highContrast ? "#000000" : "#0f1115" : "#ffffff",
    surface: dark ? highContrast ? "#101216" : "#171a20" : highContrast ? "#eef0f3" : "#f4f5f7",
    elevated: dark ? highContrast ? "#181b20" : "#20242c" : "#ffffff",
    text: dark ? highContrast ? "#ffffff" : "#f4f5f7" : highContrast ? "#000000" : "#15171a",
    secondaryText: dark ? highContrast ? "#c8cdd6" : "#969daa" : highContrast ? "#3d434c" : "#69707c",
    faintText: dark ? highContrast ? "#9da5b0" : "#656c77" : highContrast ? "#626a75" : "#9ba1aa",
    border: dark ? highContrast ? "#535b68" : "#292d35" : highContrast ? "#949ca8" : "#e5e7eb",
    accent,
    accentSoft: dark ? "rgba(42,171,238,0.16)" : "rgba(42,171,238,0.11)",
    outgoing: dark ? highContrast ? "#145d80" : "#22566f" : highContrast ? "#d9f0fb" : "#e4f3fb",
    incoming: dark ? highContrast ? "#20242b" : "#20242b" : "#ffffff",
    danger: "#e34d59",
    success: "#37ad6b",
    warning: "#e9a23b",
    overlay: "rgba(0,0,0,0.58)",
  } as const;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;
