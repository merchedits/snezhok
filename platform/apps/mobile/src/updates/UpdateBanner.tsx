import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useAndroidUpdate } from "./UpdateProvider";

export function UpdateBanner() {
  const update = useAndroidUpdate();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  if (!["available", "downloading", "ready", "error"].includes(update.phase)) return null;

  const action = update.phase === "ready" ? update.openInstaller : update.downloadAndInstall;
  const actionLabel = update.phase === "ready" ? "Install" : update.phase === "error" ? "Retry" : "Update";

  return (
    <View style={[styles.banner, { top: Math.max(8, insets.top + 4), backgroundColor: palette.elevated, borderColor: update.required ? palette.warning : palette.border }]}> 
      <Ionicons name={update.phase === "error" ? "warning-outline" : "arrow-up-circle-outline"} size={22} color={update.phase === "error" ? palette.warning : palette.accent} />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: palette.text }]}>{update.required ? "Update required" : "Snezhok update"}</Text>
        <Text numberOfLines={2} style={[styles.message, { color: palette.secondaryText }]}>{update.message}</Text>
        {update.phase === "downloading" ? <View style={[styles.track, { backgroundColor: palette.border }]}><View style={[styles.progress, { width: `${Math.round(update.progress * 100)}%`, backgroundColor: palette.accent }]} /></View> : null}
      </View>
      {update.phase !== "downloading" ? <Pressable onPress={() => void action()} style={[styles.action, { backgroundColor: palette.accent }]}><Text style={styles.actionText}>{actionLabel}</Text></Pressable> : <Text style={[styles.percent, { color: palette.secondaryText }]}>{Math.round(update.progress * 100)}%</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { position: "absolute", right: 10, left: 10, zIndex: 200, minHeight: 68, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1, borderRadius: 14, shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 10 },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: "800" },
  message: { fontSize: 12, lineHeight: 16 },
  track: { height: 3, overflow: "hidden", borderRadius: 2, marginTop: 5 },
  progress: { height: 3, borderRadius: 2 },
  action: { minWidth: 64, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 9, paddingHorizontal: 10 },
  actionText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  percent: { minWidth: 36, fontSize: 12, fontWeight: "700", textAlign: "right" },
});
