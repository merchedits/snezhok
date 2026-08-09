import type { ColorSchemeName } from "react-native";

export type Palette = ReturnType<typeof createPalette>;

export function createPalette(scheme: ColorSchemeName, highContrast = false) {
  const dark = scheme === "dark";
  return {
    dark,
    background: dark ? "#1B1D52" : "#FFD166",
    chatCanvas: dark ? "#22265F" : "#B9D7FF",
    profileCanvas: dark ? "#173F38" : "#AEE6C6",
    settingsCanvas: dark ? "#35265F" : "#C9B5FF",
    surface: dark ? highContrast ? "#343879" : "#292D68" : highContrast ? "#FFE7AE" : "#FFF0C9",
    elevated: dark ? "#343879" : "#FFF8E7",
    navigation: dark ? "#22265F" : "#FFF3D4",
    composer: dark ? "#292D68" : "#FFEDC2",
    text: dark ? "#FFF7E7" : "#1E2140",
    secondaryText: dark ? highContrast ? "#F4EDFF" : "#D5CFF0" : highContrast ? "#39334F" : "#56506E",
    faintText: dark ? highContrast ? "#D5CFF0" : "#AAA3C8" : highContrast ? "#575069" : "#817A96",
    border: dark ? highContrast ? "#FAEBC4" : "#585D99" : highContrast ? "#52475F" : "#D99463",
    outline: dark ? "#FAEBC4" : "#24233A",
    accent: dark ? "#7FA2FF" : "#3858E8",
    onAccent: dark ? "#151737" : "#FFF8E7",
    accentPressed: dark ? "#A9BEFF" : "#2941B6",
    accentSoft: dark ? "#3A4C91" : "#B9C8FF",
    outgoing: dark ? "#405AA1" : "#91B8FF",
    incoming: dark ? "#2D316D" : "#FFF3D2",
    danger: dark ? "#FF8194" : "#D02F4D",
    onDanger: dark ? "#32131D" : "#FFF8E7",
    success: dark ? "#73E0B0" : "#147C52",
    warning: dark ? "#FFC564" : "#B75A00",
    overlay: dark ? "rgba(5,6,28,0.74)" : "rgba(30,20,54,0.58)",
    moment: {
      pink: dark ? "#A83E6A" : "#FF87AE",
      coral: dark ? "#9E413E" : "#FF7568",
      butter: dark ? "#8B6B18" : "#FFD45C",
      lime: dark ? "#647A25" : "#CDEB62",
      mint: dark ? "#267956" : "#6ED9A7",
      tangerine: dark ? "#A45119" : "#FF9138",
      lavender: dark ? "#6747A4" : "#B894FF",
      sky: dark ? "#296C9C" : "#76C5FF",
    },
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
