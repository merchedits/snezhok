import type { ColorSchemeName } from "react-native";

export const brand = {
  milk: "#FFF7E8",
  ink: "#17131A",
  violet: "#6437F5",
  lime: "#D7FF29",
  pink: "#FF7EA8",
  orange: "#FF8A1F",
  sky: "#62B8FF",
  lavender: "#DCC8FF",
  mint: "#BDEFCF",
  fog: "#EFE9DF",
  warm: "#F1EBDD",
  softViolet: "#E3D4EA",
  softLime: "#F8F8C6",
  softPink: "#FFE1DC",
  softOrange: "#FFE3C4",
  softSky: "#E3ECEC",
} as const;

export type Palette = ReturnType<typeof createPalette>;

export function createPalette(scheme: ColorSchemeName, highContrast = false) {
  const dark = scheme === "dark";
  return {
    dark,
    background: dark ? "#17131A" : brand.milk,
    chatCanvas: dark ? "#1D1822" : brand.milk,
    profileCanvas: dark ? "#1D1822" : brand.milk,
    settingsCanvas: dark ? "#1D1822" : brand.milk,
    surface: dark ? "#2A242D" : brand.warm,
    elevated: dark ? "#342D38" : "#FFFCF6",
    navigation: brand.violet,
    composer: dark ? "#221D26" : brand.milk,
    text: dark ? "#FFF7E8" : brand.ink,
    secondaryText: dark ? highContrast ? "#F7F0E4" : "#C9C0CC" : highContrast ? "#302A33" : "#625A66",
    faintText: dark ? "#968C9A" : "#887F8B",
    border: dark ? "#49404E" : "#DED6CA",
    outline: dark ? "#FFF7E8" : brand.ink,
    accent: brand.violet,
    onAccent: "#FFFFFF",
    accentPressed: dark ? "#7958F8" : "#4F26D6",
    accentSoft: dark ? "#3D315A" : brand.softViolet,
    outgoing: brand.violet,
    incoming: dark ? "#302A34" : brand.warm,
    danger: dark ? "#B92E53" : "#C73558",
    onDanger: "#FFFFFF",
    success: dark ? "#8BE6B2" : "#24764A",
    warning: dark ? "#FFBE70" : "#A95A10",
    overlay: dark ? "rgba(7,4,10,0.76)" : "rgba(23,19,26,0.48)",
    pop: brand.lime,
    onPop: brand.ink,
    group: {
      violet: dark ? "#3D315A" : brand.softViolet,
      lime: dark ? "#3A4024" : brand.softLime,
      pink: dark ? "#493039" : brand.softPink,
      orange: dark ? "#4B3424" : brand.softOrange,
      sky: dark ? "#273C43" : brand.softSky,
      neutral: dark ? "#2A242D" : brand.warm,
    },
    moment: {
      pink: brand.pink,
      coral: dark ? "#D66A70" : "#F4776A",
      butter: dark ? "#CBAE4C" : "#F5D66B",
      lime: brand.lime,
      mint: brand.mint,
      tangerine: brand.orange,
      lavender: brand.lavender,
      sky: brand.sky,
    },
  } as const;
}

export const spacing = {
  micro: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  page: 20,
  xl: 24,
  section: 24,
  xxl: 32,
} as const;

export const radii = {
  micro: 4,
  sm: 8,
  control: 12,
  md: 12,
  card: 18,
  lg: 18,
  hero: 24,
  dock: 26,
  pill: 999,
} as const;

export const motion = {
  micro: 160,
  ui: 230,
  expressive: 320,
  celebration: 500,
} as const;
