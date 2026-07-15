import { memo } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { AppIcon } from "./AppIcon";

interface ConversationActionsSheetProps {
  visible: boolean;
  title: string;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
}

export const ConversationActionsSheet = memo(function ConversationActionsSheet({ visible, title, busy, onClose, onDelete }: ConversationActionsSheetProps) {
  const palette = usePalette();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return <Modal transparent visible={visible} animationType="fade" navigationBarTranslucent={false} onRequestClose={onClose}>
    <Pressable disabled={busy} onPress={onClose} style={[styles.overlay, { backgroundColor: palette.overlay }]}>
      <Pressable style={[styles.sheet, { backgroundColor: palette.elevated, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={[styles.handle, { backgroundColor: palette.faintText }]} />
        <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>{title}</Text>
        <Pressable disabled={busy} onPress={onDelete} style={({ pressed }) => [styles.action, { backgroundColor: pressed ? palette.surface : "transparent", opacity: busy ? 0.55 : 1 }]}>
          {busy ? <ActivityIndicator color={palette.danger} /> : <AppIcon name="trash-outline" size={22} color={palette.danger} />}
          <Text style={[styles.actionText, { color: palette.danger }]}>{t("deleteChat")}</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  </Modal>;
});

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 12, paddingTop: 9 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", opacity: 0.5 },
  title: { margin: 14, marginBottom: 6, fontSize: 17, fontWeight: "700" },
  action: { height: 56, borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  actionText: { fontSize: 16, fontWeight: "700" },
});
