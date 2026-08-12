import type { Message } from "@snezhok/contracts";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { api } from "../lib/api";
import { userFacingError } from "../lib/userFacingError";
import { AppIcon } from "./AppIcon";
import { CooperativeActivityCard } from "./CooperativeActivityCard";

export function TogetherHistoryModal({ visible, conversationId, onClose, onOpen }: {
  visible: boolean;
  conversationId: string;
  onClose: () => void;
  onOpen: (message: Message) => void;
}) {
  const palette = usePalette();
  const { language, t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    setLoading(true);
    setError(null);
    void api.activityHistory(conversationId)
      .then((next) => { if (current) setMessages(next.filter((message) => Boolean(message.activity))); })
      .catch((reason) => { if (current) setError(userFacingError(reason, t)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [conversationId, reload, t, visible]);

  return <Modal visible={visible} statusBarTranslucent animationType="slide" onRequestClose={onClose}>
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={language === "ru" ? "Назад" : "Back"} onPress={onClose} style={styles.headerButton}><AppIcon name="chevron-back" size={24} color={palette.text} /></Pressable>
        <View style={styles.headerCopy}><Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>{language === "ru" ? "Вместе" : "Together"}</Text><Text style={[styles.subtitle, { color: palette.secondaryText }]}>{language === "ru" ? "Ваша общая история" : "Your shared history"}</Text></View>
        <View style={styles.headerButton} />
      </View>
      {loading && !messages.length ? <View style={styles.center}><ActivityIndicator color={palette.accent} /></View>
        : error ? <View style={styles.center}><AppIcon name="warning-outline" size={30} color={palette.secondaryText} /><Text accessibilityRole="alert" style={[styles.emptyText, { color: palette.secondaryText }]}>{error}</Text><Pressable accessibilityRole="button" onPress={() => setReload((value) => value + 1)} style={[styles.retry, { backgroundColor: palette.accent }]}><Text style={styles.retryText}>{language === "ru" ? "Повторить" : "Retry"}</Text></Pressable></View>
          : <FlatList
            data={messages}
            keyExtractor={(message) => message.id}
            contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom, 18) }, !messages.length && styles.emptyList]}
            renderItem={({ item }) => item.activity ? <CooperativeActivityCard activity={item.activity} onOpen={() => onOpen(item)} /> : null}
            ListEmptyComponent={<View style={styles.center}><AppIcon name="sparkles-outline" size={34} color={palette.accent} /><Text style={[styles.emptyTitle, { color: palette.text }]}>{language === "ru" ? "История только начинается" : "Your story starts here"}</Text><Text style={[styles.emptyText, { color: palette.secondaryText }]}>{language === "ru" ? "Завершённые игры, вопросы, фильмы и капсулы появятся здесь автоматически." : "Completed games, questions, movies and capsules will appear here automatically."}</Text></View>}
          />}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 68, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  headerButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, alignItems: "center" },
  title: { fontSize: 21, lineHeight: 25, fontWeight: "800" },
  subtitle: { fontSize: 12, marginTop: 2 },
  list: { alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  emptyList: { flexGrow: 1 },
  center: { flex: 1, minHeight: 260, paddingHorizontal: 30, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: "800", textAlign: "center" },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  retry: { minWidth: 130, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 4 },
  retryText: { color: "#FFF", fontWeight: "800" },
});
