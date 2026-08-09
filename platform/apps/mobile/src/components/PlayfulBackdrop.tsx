import { memo } from "react";
import { StyleSheet, View } from "react-native";

import { usePalette } from "../hooks/usePalette";

export type PlayfulBackdropVariant = "chats" | "chat" | "profile" | "settings";

/** Two quiet editorial gestures, intentionally kept away from working content. */
export const PlayfulBackdrop = memo(function PlayfulBackdrop({ variant }: { variant: PlayfulBackdropVariant }) {
  const palette = usePalette();
  const variantStyle = variantStyles[variant];
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.layer}>
      <View style={[styles.arc, variantStyle.arc, { borderColor: palette.accentSoft }]} />
      <View style={[styles.dot, variantStyle.dot, { backgroundColor: palette.group.lime }]} />
      <View style={[styles.squiggle, variantStyle.squiggle, { borderColor: palette.accent }]} />
    </View>
  );
});

const variantStyles = {
  chats: { arc: { right: -150, top: 82 }, dot: { left: -66, bottom: 120 }, squiggle: { right: 26, bottom: 172, transform: [{ rotate: "18deg" }] } },
  chat: { arc: { left: -154, top: 118 }, dot: { right: -58, bottom: 92 }, squiggle: { right: 30, top: 118, transform: [{ rotate: "-14deg" }] } },
  profile: { arc: { right: -144, bottom: 84 }, dot: { left: -48, top: 132 }, squiggle: { left: 36, bottom: 150, transform: [{ rotate: "11deg" }] } },
  settings: { arc: { left: -160, bottom: 72 }, dot: { right: -55, top: 146 }, squiggle: { right: 38, bottom: 142, transform: [{ rotate: "-19deg" }] } },
} as const;

const styles = StyleSheet.create({
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" },
  arc: { position: "absolute", width: 210, height: 210, borderRadius: 105, borderWidth: 26, opacity: 0.26 },
  dot: { position: "absolute", width: 92, height: 92, borderRadius: 46, opacity: 0.18 },
  squiggle: { position: "absolute", width: 76, height: 28, borderTopWidth: 5, borderBottomWidth: 5, borderRadius: 18, opacity: 0.34 },
});
