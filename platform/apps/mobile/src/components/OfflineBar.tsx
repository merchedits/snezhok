import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useAppStore } from "../store/useAppStore";

export function OfflineBar() {
  const online = useAppStore((state) => state.online);
  const outbox = useAppStore((state) => state.outbox.length);
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  if (online) return null;
  return (
    <View style={[styles.bar, { minHeight: 27 + insets.top, paddingTop: insets.top, backgroundColor: palette.warning }]}>
      <Text style={styles.text}>Offline{outbox > 0 ? ` · ${outbox} message${outbox === 1 ? "" : "s"} waiting` : ""}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 27, justifyContent: "center", alignItems: "center", paddingHorizontal: 12 },
  text: { color: "#151515", fontSize: 12, fontWeight: "700" },
});
