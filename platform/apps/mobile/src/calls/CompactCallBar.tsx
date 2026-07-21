import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "../components/AppIcon";
import { usePalette } from "../hooks/usePalette";
import { callCopy, type CallLanguage } from "./callStrings";

export function CompactCallBar({ visible, title, language, microphoneEnabled, reconnecting, onOpen, onToggleMicrophone, onLeave }: {
  visible: boolean;
  title: string;
  language: CallLanguage;
  microphoneEnabled: boolean;
  reconnecting: boolean;
  onOpen: () => void;
  onToggleMicrophone: () => void;
  onLeave: () => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const copy = callCopy(language);
  if (!visible) return null;
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    <View style={[styles.bar, { top: Math.max(insets.top + 5, 10), backgroundColor: palette.elevated, borderColor: palette.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={copy.returnToCall} onPress={onOpen} style={({ pressed }) => [styles.identity, pressed && styles.pressed]}>
        <View style={[styles.statusDot, { backgroundColor: reconnecting ? palette.warning : palette.success }]} />
        <View style={styles.copy}><Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>{title}</Text><Text style={[styles.subtitle, { color: reconnecting ? palette.warning : palette.secondaryText }]}>{reconnecting ? "…" : copy.active}</Text></View>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onToggleMicrophone} style={({ pressed }) => [styles.button, { backgroundColor: microphoneEnabled ? palette.surface : palette.danger }, pressed && styles.pressed]}><AppIcon name={microphoneEnabled ? "mic" : "mic-off"} size={19} color={microphoneEnabled ? palette.text : "white"} /></Pressable>
      <Pressable accessibilityRole="button" onPress={onLeave} style={({ pressed }) => [styles.button, { backgroundColor: palette.danger, transform: [{ rotate: "135deg" }] }, pressed && styles.pressed]}><AppIcon name="call" size={19} color="white" /></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  bar: { position: "absolute", zIndex: 1000, elevation: 30, left: 10, right: 10, minHeight: 56, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, shadowColor: "#000", shadowOpacity: 0.24, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  identity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  statusDot: { width: 9, height: 9, borderRadius: 5, marginHorizontal: 6 },
  copy: { flex: 1, minWidth: 0, marginLeft: 4 },
  title: { fontSize: 14, lineHeight: 18, fontWeight: "800" },
  subtitle: { fontSize: 11, lineHeight: 14, marginTop: 1 },
  button: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginLeft: 7 },
  pressed: { opacity: 0.62 },
});
