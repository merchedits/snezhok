import * as Haptics from "expo-haptics";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import type { ConversationSummary } from "@snezhok/contracts";

import { AppIcon } from "../components/AppIcon";
import { useAppDialog } from "../components/AppDialogProvider";
import { Avatar } from "../components/Avatar";
import { ConversationActionsSheet } from "../components/ConversationActionsSheet";
import { NewConversationModal } from "../components/NewConversationModal";
import { MessageSearchModal } from "../components/MessageSearchModal";
import { ScreenHeader } from "../components/ScreenHeader";
import { TextEntryModal } from "../components/TextEntryModal";
import { usePalette } from "../hooks/usePalette";
import { useUiPreferences } from "../hooks/useUiPreferences";
import { prefetchAuthorizedMedia } from "../hooks/useAuthorizedMedia";
import { useTranslation } from "../i18n";
import { recentMediaPreviewUris } from "../lib/chatWarmup";
import { visibleConversationSummaries } from "../lib/conversationList";
import { directPeer, startsRegularConversationSection } from "../store/conversationIdentity";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList } from "../types";

interface ConversationListRow {
  conversation: ConversationSummary;
  sectionBreak: boolean;
}

export function ChatsScreen({ embedded: _embedded = false, active = true }: { embedded?: boolean; active?: boolean }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const screenFocused = useIsFocused();
  const palette = usePalette();
  const ui = useUiPreferences();
  const { language, t } = useTranslation();
  const showDialog = useAppDialog();
  const conversations = useAppStore((state) => state.conversations);
  const channels = useAppStore((state) => state.channels);
  const me = useAppStore((state) => state.me);
  const applyConversation = useAppStore((state) => state.applyConversation);
  const syncing = useAppStore((state) => state.syncing);
  const refresh = useAppStore((state) => state.refreshBootstrap);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const drafts = useAppStore((state) => state.drafts);
  const folders = useAppStore((state) => state.folders);
  const createFolder = useAppStore((state) => state.createFolder);
  const setFolderMembership = useAppStore((state) => state.setFolderMembership);
  const setConversationPreference = useAppStore((state) => state.setConversationPreference);
  const markStreamUnread = useAppStore((state) => state.markStreamUnread);
  const [search, setSearch] = useState("");
  const [newMessage, setNewMessage] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState("all");
  const [newFolder, setNewFolder] = useState(false);
  const [globalSearch, setGlobalSearch] = useState(false);
  const foregroundActive = active && screenFocused;
  const rowHeight = ui.dense(72, 62);
  const warmConversationKey = useMemo(() => conversations.slice(0, 6).map((conversation) => conversation.id).join(","), [conversations]);

  useEffect(() => {
    if (!foregroundActive || !warmConversationKey) return;
    const timer = setTimeout(() => {
      const streamIds = warmConversationKey.split(",").filter(Boolean);
      // Message rows are restored from SQLite during application startup.
      // Warm only already-cached thumbnails here: fetching and reconciling six
      // chats behind a tap can steal the JS thread from the native transition.
      const previews = recentMediaPreviewUris(useAppStore.getState().messages, streamIds, 6);
      void prefetchAuthorizedMedia(previews).catch(() => false);
    }, 1_200);
    return () => clearTimeout(timer);
  }, [foregroundActive, warmConversationKey]);

  const filtered = useMemo(() => {
    const folder = folders.find((item) => item.id === filter);
    const folderIds = folder ? new Set(folder.streams.filter((item) => item.streamKind === "conversation").map((item) => item.streamId)) : null;
    const source = filter === "archived" ? conversations.filter((item) => item.archived)
      : folderIds ? conversations.filter((item) => folderIds.has(item.id))
        : conversations;
    return visibleConversationSummaries(source, search, (conversation) => conversationTitle(conversation, language), filter === "archived" || Boolean(folder?.includeArchived));
  }, [conversations, filter, folders, language, search]);
  const rows = useMemo(() => filtered.map((conversation, index) => ({
    conversation,
    sectionBreak: startsRegularConversationSection(filtered, index),
  })), [filtered]);

  const chatParams = useCallback((conversation: ConversationSummary, openedAt?: number) => ({
    streamId: conversation.id,
    streamKind: "conversation" as const,
    title: conversationTitle(conversation, language),
    ...(openedAt === undefined ? {} : { openedAt }),
  }), [language]);

  const openConversation = useCallback((conversation: ConversationSummary) => {
    navigation.navigate("Chat", chatParams(conversation, performance.now()));
  }, [chatParams, navigation]);
  const selectConversation = useCallback((conversation: ConversationSummary) => {
    if (conversation.saved) return;
    setSelectedConversation(conversation);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  }, []);
  const renderConversation = useCallback(({ item }: { item: ConversationListRow }) => <ConversationRow
    conversation={item.conversation}
    currentUserId={me?.id}
    sectionBreak={item.sectionBreak}
    draft={drafts[item.conversation.id] ?? ""}
    onPress={openConversation}
    onLongPress={selectConversation}
  />, [drafts, me?.id, openConversation, selectConversation]);
  const confirmDelete = useCallback(() => {
    const conversation = selectedConversation;
    if (!conversation || deleting) return;
    showDialog(t("deleteChatTitle"), t("deleteChatDescription"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("deleteChat"),
        style: "destructive",
        onPress: () => {
          setDeleting(true);
          void deleteConversation(conversation.id)
            .then(() => setSelectedConversation(null))
            .catch(() => showDialog(t("requestFailed"), t("tryAgain")))
            .finally(() => setDeleting(false));
        },
      },
    ]);
  }, [deleteConversation, deleting, selectedConversation, showDialog, t]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}> 
      <ScreenHeader title={t("chats")} />
      <View style={[styles.search, { backgroundColor: palette.surface }]}> 
        <AppIcon name="search" size={18} color={palette.faintText} />
        <TextInput value={search} onChangeText={setSearch} placeholder={t("search")} placeholderTextColor={palette.faintText} style={[styles.searchInput, { color: palette.text }]} />
        <Pressable accessibilityLabel={t("globalSearch")} onPress={() => setGlobalSearch(true)}><AppIcon name="options-outline" size={19} color={palette.accent} /></Pressable>
      </View>
      <ScrollView horizontal style={styles.filterStrip} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <FilterChip label={t("allChats")} active={filter === "all"} onPress={() => setFilter("all")} />
        <FilterChip label={t("archivedChats")} active={filter === "archived"} onPress={() => setFilter("archived")} />
        {folders.map((folder) => <FilterChip key={folder.id} label={folder.name} active={filter === folder.id} onPress={() => setFilter(folder.id)} />)}
        <FilterChip label="+" active={false} onPress={() => setNewFolder(true)} />
      </ScrollView>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={rows}
        keyExtractor={(item) => item.conversation.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={Platform.OS === "android"}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={40}
        windowSize={5}
        getItemLayout={(_data, index) => ({ length: rowHeight, offset: rowHeight * index, index })}
        refreshControl={<RefreshControl refreshing={syncing} tintColor={palette.accent} onRefresh={() => void refresh({ force: true })} />}
        renderItem={renderConversation}
        ListEmptyComponent={<View style={styles.empty}><Text style={[styles.emptyTitle, { color: palette.text }]}>{t("noConversations")}</Text><Text style={[styles.emptyText, { color: palette.secondaryText }]}>{t("startFromProfile")}</Text></View>}
      />
      <Pressable accessibilityLabel={t("newMessage")} onPress={() => setNewMessage(true)} style={({ pressed }) => [styles.fab, { bottom: 16, backgroundColor: palette.accent, opacity: pressed ? 0.78 : 1 }]}><AppIcon name="create-outline" size={24} color="white" /></Pressable>
      <NewConversationModal
        visible={newMessage}
        onClose={() => setNewMessage(false)}
        onCreated={(conversation) => {
          setNewMessage(false);
          applyConversation(conversation);
          navigation.navigate("Chat", { streamId: conversation.id, streamKind: "conversation", title: conversation.title, openedAt: performance.now() });
        }}
      />
      <ConversationActionsSheet
        visible={Boolean(selectedConversation)}
        title={selectedConversation ? conversationTitle(selectedConversation, language) : ""}
        busy={deleting}
        pinned={selectedConversation?.pinned ?? false}
        archived={selectedConversation?.archived ?? false}
        muted={selectedConversation?.muted ?? false}
        unread={(selectedConversation?.unreadCount ?? 0) > 0}
        onClose={() => { if (!deleting) setSelectedConversation(null); }}
        onPin={() => { if (selectedConversation) void setConversationPreference(selectedConversation, { pinned: !selectedConversation.pinned }).then(() => setSelectedConversation(null)).catch(() => showDialog(t("requestFailed"), t("tryAgain"))); }}
        onArchive={() => { if (selectedConversation) void setConversationPreference(selectedConversation, { archived: !selectedConversation.archived }).then(() => setSelectedConversation(null)).catch(() => showDialog(t("requestFailed"), t("tryAgain"))); }}
        onMute={() => { if (selectedConversation) void setConversationPreference(selectedConversation, { muted: !selectedConversation.muted }).then(() => setSelectedConversation(null)).catch(() => showDialog(t("requestFailed"), t("tryAgain"))); }}
        onMarkUnread={() => {
          const conversation = selectedConversation;
          if (!conversation) return;
          setSelectedConversation(null);
          void markStreamUnread(conversation.id).catch(() => showDialog(t("requestFailed"), t("markUnreadFailed")));
        }}
        onAddToFolder={() => setNewFolder(true)}
        folders={folders}
        conversationId={selectedConversation?.id ?? null}
        onToggleFolder={(folder, included) => {
          const conversation = selectedConversation;
          if (!conversation) return;
          void setFolderMembership(folder, { streamKind: "conversation", streamId: conversation.id }, included)
            .then(() => setSelectedConversation(null))
            .catch(() => showDialog(t("requestFailed"), t("tryAgain")));
        }}
        onDelete={confirmDelete}
      />
      <TextEntryModal visible={newFolder} title={t("newFolder")} placeholder={t("folderName")} submitLabel={t("create")} onClose={() => setNewFolder(false)} onSubmit={async (name) => { await createFolder(name, selectedConversation ? [{ streamKind: "conversation", streamId: selectedConversation.id }] : []); setSelectedConversation(null); }} />
      <MessageSearchModal visible={globalSearch} onClose={() => setGlobalSearch(false)} onOpenUser={(user) => { setGlobalSearch(false); navigation.navigate("Profile", { userId: user.id }); }} onOpenMessage={(message) => {
        setGlobalSearch(false);
        const conversation = conversations.find((item) => item.id === message.streamId);
        const channel = channels.find((item) => item.id === message.streamId);
        if (conversation) navigation.navigate("Chat", { streamId: conversation.id, streamKind: "conversation", title: conversationTitle(conversation, language), targetMessageId: message.id, openedAt: performance.now() });
        else if (channel) navigation.navigate("Chat", { streamId: channel.id, streamKind: "channel", title: channel.name, targetMessageId: message.id, openedAt: performance.now() });
      }} />
    </View>
  );
}

interface ConversationRowProps extends ConversationListRow {
  currentUserId: string | undefined;
  onPress: (conversation: ConversationSummary) => void;
  onLongPress: (conversation: ConversationSummary) => void;
  draft: string;
}

const ConversationRow = memo(function ConversationRow({ conversation, currentUserId, sectionBreak, draft, onPress, onLongPress }: ConversationRowProps) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const { language, t } = useTranslation();
  const title = conversationTitle(conversation, language);
  const peer = directPeer(conversation, currentUserId);
  return (
    <Pressable
      delayLongPress={320}
      onPress={() => onPress(conversation)}
      onLongPress={() => onLongPress(conversation)}
      style={({ pressed }) => [styles.row, sectionBreak && styles.sectionBreak, { height: ui.dense(72, 62), backgroundColor: pressed ? palette.surface : palette.background }]}
    >
      {conversation.saved
        ? <View style={[styles.savedAvatar, { width: ui.dense(52, 46), height: ui.dense(52, 46), borderRadius: ui.dense(26, 23), backgroundColor: palette.accent }]}><AppIcon name="bookmark" size={24} color="white" /></View>
        : <Avatar uri={conversation.avatarUrl ?? peer?.avatarUrl ?? null} label={title} color={peer?.avatarColor} online={peer?.presence === "online"} size={ui.dense(52, 46)} />}
      <View style={[styles.rowBody, { borderColor: palette.border }]}> 
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.text, fontSize: ui.font(16) }]}>{title}</Text>
          <Text style={[styles.time, { color: conversation.unreadCount ? palette.accent : palette.faintText, fontSize: ui.font(12) }]}>{formatListTime(conversation.updatedAt)}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text numberOfLines={1} style={[styles.preview, { color: conversation.unreadCount ? palette.text : palette.secondaryText, fontSize: ui.font(14) }]}>
            {draft ? `${t("draft")}: ${draft}` : conversation.lastMessage ? `${conversation.lastMessage.senderName}: ${conversation.lastMessage.text || mediaLabel(conversation.lastMessage.kind, t)}` : peer ? `@${peer.username}` : t("noMessagesYet")}
          </Text>
          {conversation.muted ? <AppIcon name="volume-mute" size={14} color={palette.faintText} /> : null}
          {conversation.unreadCount > 0 ? <View style={[styles.unreadBadge, { backgroundColor: conversation.muted ? palette.faintText : palette.accent }]}><Text style={styles.unreadText}>{conversation.unreadCount}</Text></View> : null}
        </View>
      </View>
    </Pressable>
  );
});

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  return <Pressable onPress={onPress} style={[styles.filterChip, { minHeight: ui.dense(32, 28), borderRadius: ui.dense(16, 14), backgroundColor: active ? palette.accent : palette.surface }]}><Text style={[styles.filterText, { color: active ? "white" : palette.secondaryText, fontSize: ui.font(13) }]}>{label}</Text></Pressable>;
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
  list: { flex: 1 },
  listContent: { flexGrow: 1, paddingBottom: 86 },
  search: { height: 38, marginHorizontal: 12, marginVertical: 8, borderRadius: 10, flexDirection: "row", alignItems: "center", paddingHorizontal: 11, gap: 7 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  filterStrip: { flexGrow: 0, flexShrink: 0, height: 41 },
  filters: { paddingHorizontal: 12, paddingBottom: 7, gap: 7, alignItems: "center" },
  filterChip: { minHeight: 32, borderRadius: 16, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  filterText: { fontSize: 13, fontWeight: "700" },
  row: { height: 72, flexDirection: "row", paddingLeft: 12, alignItems: "center" },
  sectionBreak: { borderTopWidth: 4, borderTopColor: "transparent" },
  savedAvatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, alignSelf: "stretch", justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, marginLeft: 12, paddingRight: 12 },
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
