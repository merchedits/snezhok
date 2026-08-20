import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Message } from "@snezhok/contracts";

import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { AppIcon } from "../AppIcon";

export function ChatPinnedBanner({ message, onPress }: { message: Message | undefined; onPress: () => void }) {
  const palette = usePalette();
  const { t } = useTranslation();
  if (!message) return null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.banner, { borderColor: palette.outline, backgroundColor: pressed ? palette.accentSoft : palette.moment.butter }]}
    >
      <View style={[styles.accent, { backgroundColor: palette.accent }]} />
      <AppIcon name="pin" size={17} color={palette.accent} />
      <View style={styles.copy}>
        <Text style={[styles.label, { color: palette.accent }]}>{t("pinnedMessage")}</Text>
        <Text numberOfLines={1} style={[styles.text, { color: palette.secondaryText }]}>{message.text || t("attachment")}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { minHeight: 46, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  accent: { width: 3, height: 29, borderRadius: 2 },
  copy: { flex: 1, minWidth: 0 },
  label: { fontSize: 12, fontWeight: "800" },
  text: { fontSize: 12, marginTop: 1 },
});
