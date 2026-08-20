import { StyleSheet, Text, View } from "react-native";

import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";

export function ChatDayDivider({ timestamp }: { timestamp: number }) {
  const palette = usePalette();
  return (
    <View style={styles.day}>
      <View style={[styles.line, { backgroundColor: palette.border }]} />
      <Text style={[styles.dayText, { color: palette.secondaryText }]}>
        {new Date(timestamp).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
      </Text>
      <View style={[styles.line, { backgroundColor: palette.border }]} />
    </View>
  );
}

export function ChatUnreadDivider() {
  const palette = usePalette();
  const { t } = useTranslation();
  return (
    <View accessibilityRole="text" style={styles.unread}>
      <View style={[styles.line, { backgroundColor: palette.accent }]} />
      <Text style={[styles.unreadText, { color: palette.accent }]}>{t("unreadMessages")}</Text>
      <View style={[styles.line, { backgroundColor: palette.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  day: { width: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, marginVertical: 10 },
  unread: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 12, marginVertical: 5 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  dayText: { fontSize: 11, fontWeight: "700" },
  unreadText: { fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
});
