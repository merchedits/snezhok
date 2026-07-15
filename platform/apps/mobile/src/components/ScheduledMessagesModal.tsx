import { memo } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import type { ScheduledMessage } from "../types";
import { AppIcon } from "./AppIcon";

interface ScheduledMessagesModalProps {
  visible: boolean;
  messages: ScheduledMessage[];
  cancellingId: string | null;
  onClose: () => void;
  onCancel: (message: ScheduledMessage) => void;
}

export const ScheduledMessagesModal = memo(function ScheduledMessagesModal({ visible, messages, cancellingId, onClose, onCancel }: ScheduledMessagesModalProps) {
  const palette = usePalette();
  const { language, t } = useTranslation();
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <View style={[styles.layer, { paddingTop: Math.max(insets.top, 18), paddingBottom: Math.max(insets.bottom, 18) }]}>
      <Pressable onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} />
      <View style={[styles.card, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
        <View style={styles.header}>
          <View style={[styles.icon, { backgroundColor: palette.accentSoft }]}><AppIcon name="time-outline" size={20} color={palette.accent} /></View>
          <Text style={[styles.title, { color: palette.text }]}>{t("scheduledMessages")}</Text>
          <Pressable accessibilityLabel={t("close")} onPress={onClose} style={styles.close}><AppIcon name="close" size={21} color={palette.secondaryText} /></Pressable>
        </View>
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={messages.length ? styles.content : styles.emptyContent}
          ListEmptyComponent={<><AppIcon name="time-outline" size={34} color={palette.faintText} /><Text style={[styles.emptyTitle, { color: palette.text }]}>{t("noScheduledMessages")}</Text><Text style={[styles.emptyText, { color: palette.secondaryText }]}>{t("scheduleHint")}</Text></>}
          renderItem={({ item }) => <View style={[styles.row, { borderColor: palette.border }]}>
            <View style={styles.copy}>
              <Text numberOfLines={2} style={[styles.message, { color: palette.text }]}>{item.text || t("attachment")}</Text>
              <Text style={[styles.time, { color: palette.secondaryText }]}>{new Date(item.scheduledFor).toLocaleString(language === "ru" ? "ru-RU" : "en-US", { dateStyle: "medium", timeStyle: "short" })}{item.silent ? ` · ${t("silent")}` : ""}</Text>
            </View>
            <Pressable disabled={Boolean(cancellingId)} accessibilityLabel={t("cancelScheduledMessage")} onPress={() => onCancel(item)} style={({ pressed }) => [styles.delete, { backgroundColor: pressed ? palette.surface : "transparent" }]}>
              {cancellingId === item.id ? <ActivityIndicator size="small" color={palette.danger} /> : <AppIcon name="trash-outline" size={20} color={palette.danger} />}
            </Pressable>
          </View>}
        />
      </View>
    </View>
  </Modal>;
});

const styles = StyleSheet.create({
  layer: { flex: 1, justifyContent: "center", paddingHorizontal: 18 },
  card: { maxHeight: "72%", borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", elevation: 16 },
  header: { minHeight: 62, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 11 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800" },
  close: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
  list: { flexGrow: 0 },
  content: { paddingHorizontal: 14, paddingBottom: 14 },
  emptyContent: { padding: 34, alignItems: "center" },
  emptyTitle: { marginTop: 13, fontSize: 16, fontWeight: "800" },
  emptyText: { marginTop: 6, fontSize: 13, lineHeight: 18, textAlign: "center" },
  row: { minHeight: 72, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10, paddingLeft: 5, flexDirection: "row", alignItems: "center", gap: 10 },
  copy: { flex: 1 },
  message: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
  time: { marginTop: 5, fontSize: 12 },
  delete: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
});
