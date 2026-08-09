import { memo } from "react";
import { StyleSheet, View } from "react-native";

import { usePalette } from "../hooks/usePalette";

export type PlayfulBackdropVariant = "chats" | "chat" | "profile" | "settings";

const colorOrder: Record<PlayfulBackdropVariant, ["pink" | "coral" | "butter" | "lime" | "mint" | "tangerine" | "lavender" | "sky", "pink" | "coral" | "butter" | "lime" | "mint" | "tangerine" | "lavender" | "sky", "pink" | "coral" | "butter" | "lime" | "mint" | "tangerine" | "lavender" | "sky"]> = {
  chats: ["pink", "lavender", "sky"],
  chat: ["butter", "pink", "mint"],
  profile: ["sky", "lavender", "butter"],
  settings: ["tangerine", "pink", "lime"],
};

/**
 * A static, compositor-cheap layer of flat shapes. It gives each primary
 * destination a recognizable mood without adding image downloads, animation,
 * or per-frame JS work on low-end Android devices.
 */
export const PlayfulBackdrop = memo(function PlayfulBackdrop({ variant }: { variant: PlayfulBackdropVariant }) {
  const palette = usePalette();
  const [first, second, third] = colorOrder[variant];
  const fillOpacity = palette.dark ? 0.28 : 0.52;
  const lineOpacity = palette.dark ? 0.42 : 0.66;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.layer}>
      <View style={[styles.orb, styles.orbTop, variant === "chat" && styles.orbTopChat, { backgroundColor: palette.moment[first], opacity: fillOpacity }]} />
      <View style={[styles.orb, styles.orbBottom, variant === "profile" && styles.orbBottomProfile, { backgroundColor: palette.moment[second], opacity: fillOpacity }]} />
      <View style={[styles.loop, variant === "settings" && styles.loopSettings, { borderColor: palette.moment[third], opacity: lineOpacity }]} />
      <View style={[styles.spark, { backgroundColor: palette.moment[third], opacity: lineOpacity, transform: [{ rotate: "18deg" }] }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" },
  orb: { position: "absolute", borderRadius: 999 },
  orbTop: { width: 210, height: 210, right: -82, top: 56 },
  orbTopChat: { width: 176, height: 176, right: -66, top: 118 },
  orbBottom: { width: 270, height: 190, left: -112, bottom: 58, transform: [{ rotate: "-18deg" }] },
  orbBottomProfile: { left: -76, bottom: 144 },
  loop: { position: "absolute", width: 246, height: 118, right: -82, bottom: 168, borderWidth: 15, borderRadius: 90, transform: [{ rotate: "-32deg" }] },
  loopSettings: { right: -108, bottom: 288, transform: [{ rotate: "28deg" }] },
  spark: { position: "absolute", left: 28, top: 138, width: 28, height: 28, borderTopLeftRadius: 22, borderBottomRightRadius: 22 },
});
