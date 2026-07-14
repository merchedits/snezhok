import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";

import type { ConversationSummary } from "@snezhok/contracts";

import { Avatar } from "../components/Avatar";
import { NewConversationModal } from "../components/NewConversationModal";
import { ScreenHeader } from "../components/ScreenHeader";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { directPeer, startsRegularConversationSection } from "../store/conversationIdentity";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList } from "../types";

export function ChatsScreen({ embedded: _embedded = false }: { embedded?: boolean }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const palette = usePalette();
  const { language, t } = useTranslation();
  const conversations = useAppStore((state) => state.conversations);
  const me = useAppStore((state) => state.me);
  const applyConversation = useAppStore((state) => state.applyConversation);
  const syncing = useAppStore((state) => state.syncing);
  const refresh = useAppStore((state) => state.refreshBootstrap);
  const [search, setSearch] = useState("");
  const [newMessage, setNewMessage] = useState(false);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations
      .filter((item) => !item.archived && (!query || conversationTitle(item, language).toLowerCase().includes(query) || item.lastMessage?.text.toLowerCase().includes(query)))
      .sort((a, b) => Number(b.saved) - Number(a.saved) || Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [conversations, language, search]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}> 
      <ScreenHeader title={t("chats")} />
      <View style={[styles.search, { backgroundColor: palette.surface }]}> 
        <Ionicons name="search" size={18} color={palette.faintText} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t("search")}
          placeholderTextColor={palette.faintText}
          style={[styles.searchInput, { color: palette.text }]}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={syncing} tintColor={palette.accent} onRefresh={() => void refresh()} />}
        renderItem={({ item, index }) => <ConversationRow conversation={item} currentUserId={me?.id} sectionBreak={startsRegularConversationSection(filtered, index)} onPress={() => navigation.navigate("Chat", { streamId: item.id, streamKind: "conversation", title: conversationTitle(item, language) })} />}
        ListEmptyComponent={<View style={styles.empty}><Text style={[styles.emptyTitle, { color: palette.text }]}>{t("noConversations")}</Text><Text style={[styles.emptyText, { color: palette.secondaryText }]}>{t("startFromProfile")}</Text></View>}
      />
      <Pressable accessibilityLabel={t("newMessage")} onPress={() => setNewMessage(true)} style={({ pressed }) => [styles.fab, { bottom: 16, backgroundColor: palette.accent, opacity: pressed ? 0.78 : 1 }]}><Ionicons name="create-outline" size={24} color="white" /></Pressable>
      <NewConversationModal
        visible={newMessage}
        onClose={() => setNewMessage(false)}
        onCreated={(conversation) => {
          setNewMessage(false);
          applyConversation(conversation);
          navigation.navigate("Chat", { streamId: conversation.id, streamKind: "conversation", title: conversation.title });
        }}
      />
    </View>
  );
}

function ConversationRow({ conversation, currentUserId, sectionBreak, onPress }: { conversation: ConversationSummary; currentUserId: string | undefined; sectionBreak: boolean; onPress: () => void }) {
  const palette = usePalette();
  const { language, t } = useTranslation();
  const title = conversationTitle(conversation, language);
  const peer = directPeer(conversation, currentUserId);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, sectionBreak && styles.sectionBreak, { backgroundColor: pressed ? palette.surface : palette.background }]}>
      {conversation.saved
        ? <View style={[styles.savedAvatar, { backgroundColor: palette.accent }]}><Ionicons name="bookmark" size={24} color="white" /></View>
        : <Avatar uri={conversation.avatarUrl ?? peer?.avatarUrl ?? null} label={title} color={peer?.avatarColor} online={peer?.presence === "online"} size={52} />}
      <View style={[styles.rowBody, { borderColor: palette.border }]}> 
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.text }]}>{title}</Text>
          <Text style={[styles.time, { color: conversation.unreadCount ? palette.accent : palette.faintText }]}>{formatListTime(conversation.updatedAt)}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text numberOfLines={1} style={[styles.preview, { color: conversation.unreadCount ? palette.text : palette.secondaryText }]}>
            {conversation.lastMessage ? `${conversation.lastMessage.senderName}: ${conversation.lastMessage.text || mediaLabel(conversation.lastMessage.kind, t)}` : peer ? `@${peer.username}` : t("noMessagesYet")}
          </Text>
          {conversation.muted ? <Ionicons name="volume-mute" size={14} color={palette.faintText} /> : null}
          {conversation.unreadCount > 0 ? <View style={[styles.unreadBadge, { backgroundColor: conversation.muted ? palette.faintText : palette.accent }]}><Text style={styles.unreadText}>{conversation.unreadCount}</Text></View> : null}
        </View>
      </View>
    </Pressable>
  );
}

function conversationTitle(conversation: ConversationSummary, language: "en" | "ru"): string {
  if (!conversation.saved) return conversation.title;
  return language === "ru" ? "Сохранённые сообщения" : "Saved Messages";
}

function formatListTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function mediaLabel(kind: string, t: ReturnType<typeof useTranslation>["t"]): string {
  if (kind === "voice") return t("voiceMessage");
  if (kind === "video-note") return t("videoMessage");
  if (kind === "file") return t("file");
  return t("attachment");
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: { height: 38, marginHorizontal: 12, marginVertical: 8, borderRadius: 10, flexDirection: "row", alignItems: "center", paddingHorizontal: 11, gap: 7 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  row: { minHeight: 72, flexDirection: "row", paddingLeft: 12, alignItems: "center" },
  sectionBreak: { marginTop: 8 },
  savedAvatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, height: "100%", justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, marginLeft: 12, paddingRight: 12 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: "700" },
  time: { fontSize: 12 },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 },
  preview: { flex: 1, fontSize: 14 },
  unreadBadge: { minWidth: 21, height: 21, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  unreadText: { color: "white", fontSize: 11, fontWeight: "800" },
  empty: { paddingTop: 100, alignItems: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyText: { fontSize: 14, marginTop: 6 },
  fab: { position: "absolute", right: 18, width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", elevation: 4 },
});
