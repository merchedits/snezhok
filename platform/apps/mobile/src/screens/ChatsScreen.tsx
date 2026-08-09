import * as Haptics from "expo-haptics";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import type { ConversationSummary } from "@snezhok/contracts";

import { AppIcon } from "../components/AppIcon";
import { useAppDialog } from "../components/AppDialogProvider";
import { Avatar } from "../components/Avatar";
import { ConversationActionsSheet } from "../components/ConversationActionsSheet";
import { NewConversationModal } from "../components/NewConversationModal";
import { PlayfulBackdrop } from "../components/PlayfulBackdrop";
import { ScreenHeader } from "../components/ScreenHeader";
import { usePalette } from "../hooks/usePalette";
import { useUiPreferences } from "../hooks/useUiPreferences";
import { prefetchAuthorizedMedia } from "../hooks/useAuthorizedMedia";
import { useTranslation } from "../i18n";
import { recentMediaPreviewUris, uncachedWarmStreamIds } from "../lib/chatWarmup";
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
  const me = useAppStore((state) => state.me);
  const applyConversation = useAppStore((state) => state.applyConversation);
  const syncing = useAppStore((state) => state.syncing);
  const refresh = useAppStore((state) => state.refreshBootstrap);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const drafts = useAppStore((state) => state.drafts);
  const setConversationPreference = useAppStore((state) => state.setConversationPreference);
  const markStreamUnread = useAppStore((state) => state.markStreamUnread);
  const preloadCachedMessages = useAppStore((state) => state.preloadCachedMessages);
  const [newMessage, setNewMessage] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const foregroundActive = active && screenFocused;
  const rowHeight = ui.dense(72, 62);
  const warmConversationKey = useMemo(() => conversations.slice(0, 12).map((conversation) => conversation.id).join(","), [conversations]);

  useEffect(() => {
    if (!foregroundActive || !warmConversationKey) return;
    const timer = setTimeout(() => {
      const streamIds = warmConversationKey.split(",").filter(Boolean);
      const missing = uncachedWarmStreamIds(streamIds, useAppStore.getState().messages, 12);
      void preloadCachedMessages(missing).catch(() => undefined).then(() => {
        const previews = recentMediaPreviewUris(useAppStore.getState().messages, streamIds, 6);
        return prefetchAuthorizedMedia(previews).catch(() => false);
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [foregroundActive, preloadCachedMessages, warmConversationKey]);

  const filtered = useMemo(() => visibleConversationSummaries(
    conversations,
    "",
    (conversation) => conversationTitle(conversation, language),
    true,
  ), [conversations, language]);
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
  const warmConversation = useCallback((conversation: ConversationSummary) => {
    void preloadCachedMessages([conversation.id]).catch(() => undefined);
  }, [preloadCachedMessages]);
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
    onWarm={warmConversation}
    onPress={openConversation}
    onLongPress={selectConversation}
  />, [drafts, me?.id, openConversation, selectConversation, warmConversation]);
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
      <PlayfulBackdrop variant="chats" />
      <ScreenHeader prominent title={t("chats")} right={[{ icon: "person-circle-outline", label: t("contacts"), onPress: () => navigation.navigate("Contacts") }]} />
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
      <Pressable accessibilityLabel={t("newMessage")} onPress={() => setNewMessage(true)} style={({ pressed }) => [styles.fab, { bottom: 16, backgroundColor: palette.pop, shadowColor: palette.outline, transform: [{ scale: pressed ? 0.96 : 1 }] }]}><AppIcon name="create-outline" size={24} color={palette.onPop} /></Pressable>
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
        muted={selectedConversation?.muted ?? false}
        unread={(selectedConversation?.unreadCount ?? 0) > 0}
        onClose={() => { if (!deleting) setSelectedConversation(null); }}
        onPin={() => { if (selectedConversation) void setConversationPreference(selectedConversation, { pinned: !selectedConversation.pinned }).then(() => setSelectedConversation(null)).catch(() => showDialog(t("requestFailed"), t("tryAgain"))); }}
        onMute={() => { if (selectedConversation) void setConversationPreference(selectedConversation, { muted: !selectedConversation.muted }).then(() => setSelectedConversation(null)).catch(() => showDialog(t("requestFailed"), t("tryAgain"))); }}
        onMarkUnread={() => {
          const conversation = selectedConversation;
          if (!conversation) return;
          setSelectedConversation(null);
          void markStreamUnread(conversation.id).catch(() => showDialog(t("requestFailed"), t("markUnreadFailed")));
        }}
        conversationId={selectedConversation?.id ?? null}
        onDelete={confirmDelete}
      />
    </View>
  );
}

interface ConversationRowProps extends ConversationListRow {
  currentUserId: string | undefined;
  onWarm: (conversation: ConversationSummary) => void;
  onPress: (conversation: ConversationSummary) => void;
  onLongPress: (conversation: ConversationSummary) => void;
  draft: string;
}

const ConversationRow = memo(function ConversationRow({ conversation, currentUserId, sectionBreak, draft, onWarm, onPress, onLongPress }: ConversationRowProps) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const { language, t } = useTranslation();
  const title = conversationTitle(conversation, language);
  const peer = directPeer(conversation, currentUserId);
  const rowBackground = conversation.saved ? palette.group.violet : "transparent";
  return (
    <Pressable
      delayLongPress={320}
      onPressIn={() => onWarm(conversation)}
      onPress={() => onPress(conversation)}
      onLongPress={() => onLongPress(conversation)}
      style={({ pressed }) => [styles.row, sectionBreak && styles.sectionBreak, { height: ui.dense(72, 62), backgroundColor: pressed ? palette.accentSoft : rowBackground }]}
    >
      {conversation.saved
        ? <View style={[styles.savedAvatar, { width: ui.dense(52, 46), height: ui.dense(52, 46), borderRadius: ui.dense(26, 23), backgroundColor: palette.accent }]}><AppIcon name="bookmark" size={24} color={palette.onAccent} /></View>
        : <Avatar uri={conversation.avatarUrl ?? peer?.avatarUrl ?? null} label={title} color={peer?.avatarColor} online={peer?.presence === "online"} size={ui.dense(52, 46)} />}
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.text, fontSize: ui.font(16) }]}>{title}</Text>
          <Text style={[styles.time, { color: conversation.unreadCount ? palette.text : palette.faintText, fontSize: ui.font(12), fontWeight: conversation.unreadCount ? "800" : "500" }]}>{formatListTime(conversation.updatedAt)}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text numberOfLines={1} style={[styles.preview, { color: conversation.unreadCount ? palette.text : palette.secondaryText, fontSize: ui.font(14) }]}>
            {draft ? `${t("draft")}: ${draft}` : conversation.lastMessage ? `${conversation.lastMessage.senderName}: ${conversation.lastMessage.text || mediaLabel(conversation.lastMessage.kind, t)}` : peer ? `@${peer.username}` : t("noMessagesYet")}
          </Text>
          {conversation.muted ? <AppIcon name="volume-mute" size={14} color={palette.faintText} /> : null}
          {conversation.unreadCount > 0 ? <View style={[styles.unreadBadge, { backgroundColor: conversation.muted ? palette.faintText : palette.accent }]}><Text style={[styles.unreadText, { color: conversation.muted ? palette.text : palette.onAccent }]}>{conversation.unreadCount}</Text></View> : null}
        </View>
      </View>
    </Pressable>
  );
});

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
  listContent: { flexGrow: 1, paddingTop: 4, paddingBottom: 86 },
  row: { height: 72, flexDirection: "row", marginHorizontal: 12, marginVertical: 1, paddingHorizontal: 8, borderRadius: 18, alignItems: "center" },
  sectionBreak: { borderTopWidth: 2, borderTopColor: "transparent" },
  savedAvatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, alignSelf: "stretch", justifyContent: "center", marginLeft: 12, paddingRight: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: "700" },
  time: { fontSize: 12 },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 },
  preview: { flex: 1, fontSize: 14 },
  unreadBadge: { minWidth: 21, height: 21, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  unreadText: { fontSize: 11, fontWeight: "800" },
  empty: { paddingTop: 100, alignItems: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyText: { fontSize: 14, marginTop: 6 },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
