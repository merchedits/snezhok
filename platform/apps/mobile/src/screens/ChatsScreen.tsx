import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ChannelSummary, ConversationSummary } from "@snezhok/contracts";

import { Avatar } from "../components/Avatar";
import { NewConversationModal } from "../components/NewConversationModal";
import { ScreenHeader } from "../components/ScreenHeader";
import { ServerDrawer } from "../components/ServerDrawer";
import { usePalette } from "../hooks/usePalette";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList } from "../types";

export function ChatsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const conversations = useAppStore((state) => state.conversations);
  const syncing = useAppStore((state) => state.syncing);
  const refresh = useAppStore((state) => state.refreshBootstrap);
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [newMessage, setNewMessage] = useState(false);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations
      .filter((item) => !item.archived && (!query || item.title.toLowerCase().includes(query) || item.lastMessage?.text.toLowerCase().includes(query)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [conversations, search]);

  const openChannel = (channel: ChannelSummary) => {
    setDrawer(false);
    if (channel.kind === "voice") navigation.navigate("Call", { streamId: channel.id, title: channel.name });
    else navigation.navigate("Chat", { streamId: channel.id, streamKind: "channel", title: channel.name, subtitle: channel.topic });
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}> 
      <ScreenHeader
        title="Chats"
        left={{ icon: "menu", label: "Open servers", onPress: () => setDrawer(true) }}
      />
      <View style={[styles.search, { backgroundColor: palette.surface }]}> 
        <Ionicons name="search" size={18} color={palette.faintText} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search"
          placeholderTextColor={palette.faintText}
          style={[styles.searchInput, { color: palette.text }]}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={syncing} tintColor={palette.accent} onRefresh={() => void refresh()} />}
        renderItem={({ item }) => <ConversationRow conversation={item} onPress={() => navigation.navigate("Chat", { streamId: item.id, streamKind: "conversation", title: item.title })} />}
        ListEmptyComponent={<View style={styles.empty}><Text style={[styles.emptyTitle, { color: palette.text }]}>No conversations</Text><Text style={[styles.emptyText, { color: palette.secondaryText }]}>Start a chat from Contacts.</Text></View>}
      />
      <Pressable accessibilityLabel="New message" onPress={() => setNewMessage(true)} style={({ pressed }) => [styles.fab, { bottom: Math.max(16, insets.bottom + 12), backgroundColor: palette.accent, opacity: pressed ? 0.78 : 1 }]}><Ionicons name="create-outline" size={24} color="white" /></Pressable>
      <ServerDrawer
        visible={drawer}
        onClose={() => setDrawer(false)}
        onOpenChannel={openChannel}
        onNavigate={(destination) => {
          setDrawer(false);
          if (destination === "contacts") navigation.navigate("Contacts");
          if (destination === "settings") navigation.navigate("Settings");
        }}
      />
      <NewConversationModal
        visible={newMessage}
        onClose={() => setNewMessage(false)}
        onCreated={(conversation) => {
          setNewMessage(false);
          void refresh();
          navigation.navigate("Chat", { streamId: conversation.id, streamKind: "conversation", title: conversation.title });
        }}
      />
    </View>
  );
}

function ConversationRow({ conversation, onPress }: { conversation: ConversationSummary; onPress: () => void }) {
  const palette = usePalette();
  const peer = conversation.kind === "direct" ? conversation.participants[0] : undefined;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.surface : palette.background }]}> 
      <Avatar uri={conversation.avatarUrl ?? peer?.avatarUrl ?? null} label={conversation.title} color={peer?.avatarColor} online={peer?.presence === "online"} size={52} />
      <View style={[styles.rowBody, { borderColor: palette.border }]}> 
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.text }]}>{conversation.title}</Text>
          <Text style={[styles.time, { color: conversation.unreadCount ? palette.accent : palette.faintText }]}>{formatListTime(conversation.updatedAt)}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text numberOfLines={1} style={[styles.preview, { color: conversation.unreadCount ? palette.text : palette.secondaryText }]}>
            {conversation.lastMessage ? `${conversation.lastMessage.senderName}: ${conversation.lastMessage.text || mediaLabel(conversation.lastMessage.kind)}` : "No messages yet"}
          </Text>
          {conversation.muted ? <Ionicons name="volume-mute" size={14} color={palette.faintText} /> : null}
          {conversation.unreadCount > 0 ? <View style={[styles.unreadBadge, { backgroundColor: conversation.muted ? palette.faintText : palette.accent }]}><Text style={styles.unreadText}>{conversation.unreadCount}</Text></View> : null}
        </View>
      </View>
    </Pressable>
  );
}

function formatListTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function mediaLabel(kind: string): string {
  if (kind === "voice") return "Voice message";
  if (kind === "video-note") return "Video message";
  if (kind === "file") return "File";
  return "Attachment";
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: { height: 38, marginHorizontal: 12, marginVertical: 8, borderRadius: 10, flexDirection: "row", alignItems: "center", paddingHorizontal: 11, gap: 7 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  row: { minHeight: 72, flexDirection: "row", paddingLeft: 12, alignItems: "center" },
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
