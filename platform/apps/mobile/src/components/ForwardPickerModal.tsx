import { AppIcon } from "./AppIcon";
import { memo, useMemo } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ConversationSummary } from "@snezhok/contracts";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { Avatar } from "./Avatar";

export const ForwardPickerModal = memo(function ForwardPickerModal({ visible, busy, onClose, onSelect }: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSelect: (conversation: ConversationSummary) => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { language, t } = useTranslation();
  const conversations = useAppStore((state) => state.conversations);
  const russian = language === "ru";
  const targets = useMemo(() => conversations.filter((conversation) => !conversation.archived), [conversations]);
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent={false} onRequestClose={onClose}>
      <View style={styles.layer}>
        <Pressable accessibilityLabel={russian ? "Закрыть" : "Close"} style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 4, 12), backgroundColor: palette.elevated, borderColor: palette.border }]}>
          <View style={[styles.handle, { backgroundColor: palette.faintText }]} />
          <View style={styles.header}>
            <Pressable onPress={onClose} style={styles.headerButton}><AppIcon name="close" size={24} color={palette.accent} /></Pressable>
            <Text style={[styles.title, { color: palette.text }]}>{t("forward")}</Text>
            <View style={styles.headerButton} />
          </View>
          <FlatList
            data={targets}
            keyExtractor={(conversation) => conversation.id}
            renderItem={({ item }) => {
              const title = item.saved ? (russian ? "Избранное" : "Saved Messages") : item.title || item.participants[0]?.displayName || (russian ? "Чат" : "Chat");
              return (
                <Pressable disabled={busy} onPress={() => onSelect(item)} style={({ pressed }) => [styles.target, { backgroundColor: pressed ? palette.surface : "transparent", opacity: busy ? 0.55 : 1 }]}>
                  {item.saved
                    ? <View style={[styles.savedAvatar, { backgroundColor: palette.accent }]}><AppIcon name="bookmark" size={20} color="white" /></View>
                    : <Avatar uri={item.avatarUrl ?? item.participants[0]?.avatarUrl ?? null} label={title} color={item.participants[0]?.avatarColor} size={44} />}
                  <Text numberOfLines={1} style={[styles.targetText, { color: palette.text }]}>{title}</Text>
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  layer: { flex: 1, justifyContent: "flex-end" },
  sheet: { maxHeight: "72%", minHeight: 280, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginTop: 8, opacity: 0.5 },
  header: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "800" },
  target: { minHeight: 60, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  targetText: { flex: 1, fontSize: 16, fontWeight: "600" },
  savedAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
