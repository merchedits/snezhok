import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ConversationSummary, Message } from "@snezhok/contracts";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { Avatar } from "./Avatar";

const quickReactions = ["👍", "❤️", "😂", "🔥", "👏", "😮"] as const;

export function MessageActionsSheet({
  message,
  conversations,
  onClose,
  onReply,
  onReact,
  onForward,
}: {
  message: Message | null;
  conversations: ConversationSummary[];
  onClose: () => void;
  onReply: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  onForward: (message: Message, conversation: ConversationSummary) => void;
}) {
  const palette = usePalette();
  const { language } = useTranslation();
  const russian = language === "ru";

  return (
    <Modal visible={Boolean(message)} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.layer}>
        <Pressable accessibilityLabel={russian ? "Закрыть" : "Close"} style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} onPress={onClose} />
        {message ? (
          <View style={[styles.sheet, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
            <View style={[styles.handle, { backgroundColor: palette.faintText }]} />
            <View style={styles.reactions}>
              {quickReactions.map((emoji) => (
                <Pressable key={emoji} onPress={() => onReact(message, emoji)} style={({ pressed }) => [styles.emojiButton, { backgroundColor: pressed ? palette.accentSoft : palette.surface }]}>
                  <Text style={styles.emoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            <Action icon="return-down-back-outline" label={russian ? "Ответить" : "Reply"} onPress={() => onReply(message)} />
            <View style={[styles.divider, { backgroundColor: palette.border }]} />
            <Text style={[styles.section, { color: palette.secondaryText }]}>{russian ? "Переслать в…" : "Forward to…"}</Text>
            <ScrollView style={styles.targets} contentContainerStyle={styles.targetsContent} showsVerticalScrollIndicator={false}>
              {conversations.map((conversation) => {
                const title = conversation.saved
                  ? (russian ? "Избранное" : "Saved Messages")
                  : conversation.title || conversation.participants[0]?.displayName || (russian ? "Чат" : "Chat");
                return (
                  <Pressable key={conversation.id} onPress={() => onForward(message, conversation)} style={({ pressed }) => [styles.target, { backgroundColor: pressed ? palette.surface : "transparent" }]}>
                    {conversation.saved
                      ? <View style={[styles.savedAvatar, { backgroundColor: palette.accent }]}><Ionicons name="bookmark" size={19} color="white" /></View>
                      : <Avatar uri={conversation.avatarUrl ?? conversation.participants[0]?.avatarUrl ?? null} label={title} color={conversation.participants[0]?.avatarColor} size={38} />}
                    <Text numberOfLines={1} style={[styles.targetText, { color: palette.text }]}>{title}</Text>
                    <Ionicons name="chevron-forward" size={17} color={palette.faintText} />
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function Action({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: pressed ? palette.surface : "transparent" }]}>
      <Ionicons name={icon} size={22} color={palette.accent} />
      <Text style={[styles.actionText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1, justifyContent: "flex-end" },
  sheet: { maxHeight: "70%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingBottom: 18, overflow: "hidden" },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginTop: 8, marginBottom: 12, opacity: 0.5 },
  reactions: { flexDirection: "row", justifyContent: "space-between", gap: 5, paddingBottom: 10 },
  emojiButton: { flex: 1, aspectRatio: 1, maxHeight: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 23 },
  action: { minHeight: 50, borderRadius: 14, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 13 },
  actionText: { fontSize: 16, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 12, marginVertical: 5 },
  section: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 5, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  targets: { maxHeight: 240 },
  targetsContent: { paddingBottom: 4 },
  target: { minHeight: 54, borderRadius: 14, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 11 },
  targetText: { flex: 1, fontSize: 15, fontWeight: "600" },
  savedAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
});
