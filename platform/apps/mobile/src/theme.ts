import type { ColorSchemeName } from "react-native";

export type Palette = ReturnType<typeof createPalette>;

export function createPalette(scheme: ColorSchemeName, accent = "#3F6FE5", highContrast = false) {
  const dark = scheme === "dark";
  const resolvedAccent = dark && accent.toLowerCase() === "#3f6fe5" ? "#7EA4FF" : accent;
  return {
    dark,
    background: dark ? "#11141A" : "#FFF9EE",
    surface: dark ? highContrast ? "#252B36" : "#222731" : highContrast ? "#EFE8DC" : "#F4EFE6",
    elevated: dark ? "#292F3A" : "#FFFFFF",
    text: dark ? "#F6F3EC" : "#19202A",
    secondaryText: dark ? highContrast ? "#CED1D8" : "#B1B5BE" : highContrast ? "#424A55" : "#626A76",
    faintText: dark ? highContrast ? "#A3A9B3" : "#7F8692" : highContrast ? "#666D77" : "#9299A3",
    border: dark ? highContrast ? "#505866" : "#303641" : highContrast ? "#AAA092" : "#E9E1D5",
    accent: resolvedAccent,
    accentSoft: dark && accent.toLowerCase() === "#3f6fe5" ? "#24345C" : colorWithAlpha(resolvedAccent, dark ? 0.19 : 0.13),
    outgoing: dark ? "#24345C" : "#E5EEFF",
    incoming: dark ? "#1A1E26" : "#FFFFFF",
    danger: dark ? "#FF7A84" : "#D94A57",
    success: dark ? "#65D393" : "#2F9B61",
    warning: dark ? "#F5B95C" : "#D88B24",
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
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
} as const;

function colorWithAlpha(hex: string, alpha: number) {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "3F6FE5";
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}
