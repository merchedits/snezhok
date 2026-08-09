import { memo } from "react";
import { StyleSheet, View } from "react-native";

import { usePalette } from "../hooks/usePalette";

export type PlayfulBackdropVariant = "chats" | "chat" | "profile" | "settings";

/** Two quiet editorial gestures, intentionally kept away from working content. */
export const PlayfulBackdrop = memo(function PlayfulBackdrop({ variant }: { variant: PlayfulBackdropVariant }) {
  const palette = usePalette();
  const accent = variant === "profile" ? palette.group.pink : variant === "settings" ? palette.group.sky : palette.group.violet;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.layer}>
      <View style={[styles.arc, { borderColor: accent }]} />
      <View style={[styles.dot, { backgroundColor: variant === "chat" ? palette.group.lime : accent }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" },
  arc: { position: "absolute", width: 210, height: 210, borderRadius: 105, borderWidth: 26, right: -150, top: 82, opacity: 0.38 },
  dot: { position: "absolute", width: 92, height: 92, borderRadius: 46, left: -66, bottom: 120, opacity: 0.3 },
});
