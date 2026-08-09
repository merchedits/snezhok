import type { ColorSchemeName } from "react-native";

export const brand = {
  milk: "#FFF7E8",
  ink: "#17131A",
  violet: "#7B4DFF",
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
  void highContrast;
  return {
    dark,
    background: dark ? "#121218" : brand.milk,
    chatCanvas: dark ? "#121218" : brand.milk,
    profileCanvas: dark ? "#121218" : brand.milk,
    settingsCanvas: dark ? "#121218" : brand.milk,
    surface: dark ? "#1A1C22" : brand.warm,
    elevated: dark ? "#21242B" : "#FFFCF6",
    navigation: brand.violet,
    composer: dark ? "#221D26" : brand.milk,
    text: dark ? "#FFF7E8" : brand.ink,
    secondaryText: dark ? "#A1A6B3" : "#625A66",
    faintText: dark ? "#747985" : "#887F8B",
    border: dark ? "#2C2F3A" : "#DED6CA",
    outline: dark ? "#3A3E49" : brand.ink,
    accent: brand.violet,
    onAccent: "#FFFFFF",
    accentPressed: dark ? "#916FFF" : "#6335E8",
    accentSoft: dark ? "#30264D" : brand.softViolet,
    outgoing: brand.violet,
    incoming: dark ? "#21242B" : brand.warm,
    danger: dark ? "#FF7A9B" : "#B5244C",
    onDanger: dark ? brand.ink : "#FFFFFF",
    success: dark ? "#8BE6B2" : "#24764A",
    warning: dark ? "#FFBE70" : "#A95A10",
    overlay: dark ? "rgba(7,4,10,0.76)" : "rgba(23,19,26,0.48)",
    pop: brand.lime,
    onPop: brand.ink,
    group: {
      violet: dark ? "#30264D" : brand.softViolet,
      lime: dark ? "#292D1C" : brand.softLime,
      pink: dark ? "#21242B" : brand.warm,
      orange: dark ? "#21242B" : brand.warm,
      sky: dark ? "#21242B" : brand.warm,
      neutral: dark ? "#1A1C22" : brand.warm,
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
