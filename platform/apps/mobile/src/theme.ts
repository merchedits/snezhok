import type { ColorSchemeName } from "react-native";

export type Palette = ReturnType<typeof createPalette>;

export function createPalette(scheme: ColorSchemeName, accent = "#2aabee") {
  const dark = scheme === "dark";
  return {
    dark,
    background: dark ? "#0f1115" : "#ffffff",
    surface: dark ? "#171a20" : "#f4f5f7",
    elevated: dark ? "#20242c" : "#ffffff",
    text: dark ? "#f4f5f7" : "#15171a",
    secondaryText: dark ? "#969daa" : "#69707c",
    faintText: dark ? "#656c77" : "#9ba1aa",
    border: dark ? "#292d35" : "#e5e7eb",
    accent,
    accentSoft: dark ? "rgba(42,171,238,0.16)" : "rgba(42,171,238,0.11)",
    outgoing: dark ? "#22566f" : "#e4f3fb",
    incoming: dark ? "#20242b" : "#ffffff",
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
