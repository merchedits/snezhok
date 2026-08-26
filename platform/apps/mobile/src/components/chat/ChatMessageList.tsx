import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type ViewToken } from "react-native";
import type { SharedValue } from "react-native-reanimated";

import type { ConversationSummary, Message, UserSummary } from "@snezhok/contracts";

import { recordPerformance } from "../../diagnostics/diagnostics";
import { usePalette } from "../../hooks/usePalette";
import { prefetchAuthorizedMedia } from "../../hooks/useAuthorizedMedia";
import { useTranslation } from "../../i18n";
import { chatOpenPerformanceKind } from "../../lib/chatWarmup";
import { renderableAttachments } from "../../domains/messaging/messagePayload";
import { joinRealtimeStream, leaveRealtimeStream } from "../../lib/realtimeBridge";
import { clearVoicePlaybackQueue, setVoicePlaybackQueue } from "../../lib/voicePlaybackCoordinator";
import { dismissMessageNotifications } from "../../notifications/androidNotifications";
import { visibleMessages } from "../../domains/messaging/messageReconciliation";
import { useAppStore } from "../../store/useAppStore";
import type { RootStackParamList } from "../../types";
import { ContentFailureBoundary } from "../ContentFailureBoundary";
import { MessageBubble } from "../MessageBubble";
import { SwipeReplyRow } from "../SwipeReplyRow";
import { useAppDialog } from "../AppDialogProvider";
import { ChatDayDivider, ChatUnreadDivider } from "./ChatTimelineDividers";

const INITIAL_RENDERED_MESSAGES = 80;
const MESSAGE_PAGE_SIZE = 60;
// FlashList expresses this threshold as a viewport ratio, not density pixels.
// A value of 120 classified every scroll position as "near bottom", so merely
// focusing the composer jumped someone reading history to the newest message.
const maintainVisibleMessagePosition = { startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 } as const;
const messageKey = (message: Message) => message.id;
const messageCellType = (message: Message) => {
  if (message.activity) return `activity-${message.activity.type}`;
  const attachments = renderableAttachments(message.attachments);
  if (message.kind === "voice" || attachments.some((attachment) => attachment.kind === "audio")) return "voice";
  if (attachments.some((attachment) => attachment.kind === "image" || attachment.kind === "video")) return "media";
  return message.kind;
};

export interface ChatMessageListHandle {
  jumpToMessage: (messageId: string) => Promise<void>;
  scrollToEnd: () => void;
}

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, "Chat">;
  streamId: string;
  streamKind: "conversation" | "channel";
  title: string;
  openedAt?: number;
  targetMessageId?: string;
  messages: Message[];
  conversation?: ConversationSummary;
  channelUnreadCount: number;
  meId?: string;
  isGroup: boolean;
  selectedIds: ReadonlySet<string>;
  selectionMode: boolean;
  selectionProgress: SharedValue<number>;
  onToggleSelection: (message: Message) => void;
  onReply: (message: Message) => void;
  onOpenReactions: (message: Message, anchorY: number) => void;
  onOpenActivity: (message: Message) => void;
}

export const ChatMessageList = forwardRef<ChatMessageListHandle, Props>(function ChatMessageList({
  navigation,
  streamId,
  streamKind,
  title,
  openedAt,
  targetMessageId,
  messages,
  conversation,
  channelUnreadCount,
  meId,
  isGroup,
  selectedIds,
  selectionMode,
  selectionProgress,
  onToggleSelection,
  onReply,
  onOpenReactions,
  onOpenActivity,
}, forwardedRef) {
  const palette = usePalette();
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const isFocused = useIsFocused();
  const list = useRef<FlashListRef<Message>>(null);
  const preloadCachedMessages = useAppStore((state) => state.preloadCachedMessages);
  const loadMessages = useAppStore((state) => state.loadMessages);
  const loadPinnedMessages = useAppStore((state) => state.loadPinnedMessages);
  const loadOlderMessages = useAppStore((state) => state.loadOlderMessages);
  const loadMessageContext = useAppStore((state) => state.loadMessageContext);
  const markStreamRead = useAppStore((state) => state.markStreamRead);
  const toggleReaction = useAppStore((state) => state.toggleReaction);
  const [routeSettled, setRouteSettled] = useState(false);
  const [historyState, setHistoryState] = useState<"waiting" | "loading" | "ready" | "error">("waiting");
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDERED_MESSAGES);
  const userDraggedHistory = useRef(false);
  const initialBottomAnchored = useRef(false);
  const loadingOlder = useRef(false);
  const firstPaintRecorded = useRef(false);
  const cachedMessageCountAtOpen = useRef(messages.length);
  const warmedMediaUris = useRef(new Set<string>());
  const unreadBoundary = useRef({
    streamId,
    initialCount: Math.max(conversation?.unreadCount ?? 0, channelUnreadCount),
    sequence: null as number | null,
  });

  if (unreadBoundary.current.streamId !== streamId) {
    unreadBoundary.current = {
      streamId,
      initialCount: Math.max(conversation?.unreadCount ?? 0, channelUnreadCount),
      sequence: null,
    };
  }

  useEffect(() => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      setRouteSettled(true);
    };
    const unsubscribe = navigation.addListener("transitionEnd", (event) => { if (!event.data.closing) settle(); });
    const fallback = setTimeout(settle, 600);
    return () => { clearTimeout(fallback); unsubscribe(); };
  }, [navigation, streamId]);

  useEffect(() => { void preloadCachedMessages([streamId]).catch(() => undefined); }, [preloadCachedMessages, streamId]);
  const refreshHistory = useCallback(async () => {
    setHistoryState("loading");
    try {
      await preloadCachedMessages([streamId]);
      await loadMessages(streamId);
      setHistoryState("ready");
      void loadPinnedMessages(streamId).catch(() => undefined);
    } catch {
      setHistoryState((useAppStore.getState().messages[streamId]?.length ?? 0) > 0 ? "ready" : "error");
    }
  }, [loadMessages, loadPinnedMessages, preloadCachedMessages, streamId]);
  useEffect(() => {
    if (routeSettled) void refreshHistory();
  }, [refreshHistory, routeSettled]);
  useEffect(() => {
    if (!isFocused || !routeSettled) return;
    joinRealtimeStream(streamId);
    return () => leaveRealtimeStream(streamId);
  }, [isFocused, routeSettled, streamId]);
  useEffect(() => {
    userDraggedHistory.current = false;
    initialBottomAnchored.current = false;
    loadingOlder.current = false;
    firstPaintRecorded.current = false;
    warmedMediaUris.current.clear();
    cachedMessageCountAtOpen.current = useAppStore.getState().messages[streamId]?.length ?? 0;
    setRouteSettled(false);
    setHistoryState("waiting");
    setRenderLimit(INITIAL_RENDERED_MESSAGES);
  }, [streamId]);

  const displayMessages = useMemo(() => visibleMessages(messages), [messages]);
  if (unreadBoundary.current.sequence === null && unreadBoundary.current.initialCount > 0 && displayMessages.length > 0) {
    const boundaryIndex = Math.max(0, displayMessages.length - unreadBoundary.current.initialCount);
    unreadBoundary.current.sequence = displayMessages[boundaryIndex]?.sequence ?? null;
  }
  const renderedMessages = useMemo(() => displayMessages.slice(-renderLimit), [displayMessages, renderLimit]);
  const latestSequence = useMemo(() => messages.reduce((maximum, message) => Math.max(maximum, message.sequence), 0), [messages]);
  const voiceAttachmentIds = useMemo(() => displayMessages.flatMap((message) => renderableAttachments(message.attachments)
    .filter((attachment) => attachment.kind === "audio")
    .map((attachment) => attachment.id)), [displayMessages]);
  const voiceAttachmentKey = voiceAttachmentIds.join(",");

  useEffect(() => {
    if (initialBottomAnchored.current || targetMessageId || userDraggedHistory.current || renderedMessages.length === 0) return;
    initialBottomAnchored.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      list.current?.scrollToEnd({ animated: false });
    }));
  }, [renderedMessages.length, streamId, targetMessageId]);

  useEffect(() => { setVoicePlaybackQueue(streamId, voiceAttachmentIds); }, [streamId, voiceAttachmentKey]);
  useEffect(() => () => clearVoicePlaybackQueue(streamId), [streamId]);
  useEffect(() => {
    if (!isFocused || !routeSettled || latestSequence <= 0) return;
    void markStreamRead(streamId, latestSequence).catch(() => undefined);
  }, [isFocused, latestSequence, markStreamRead, routeSettled, streamId]);
  useEffect(() => {
    if (isFocused && routeSettled) void dismissMessageNotifications(streamId).catch(() => undefined);
  }, [isFocused, routeSettled, streamId]);

  const jumpToMessage = useCallback(async (messageId: string) => {
    await loadMessageContext(streamId, messageId).catch(() => undefined);
    const current = visibleMessages(useAppStore.getState().messages[streamId] ?? []);
    const index = current.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const required = Math.min(current.length, current.length - index + 12);
    const nextLimit = Math.max(renderLimit, required);
    setRenderLimit(nextLimit);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const windowStart = Math.max(0, current.length - nextLimit);
      list.current?.scrollToIndex({ index: index - windowStart, animated: true, viewPosition: 0.25 });
    }));
  }, [loadMessageContext, renderLimit, streamId]);

  useImperativeHandle(forwardedRef, () => ({
    jumpToMessage,
    scrollToEnd: () => list.current?.scrollToEnd({ animated: true }),
  }), [jumpToMessage]);

  useEffect(() => { if (targetMessageId) void jumpToMessage(targetMessageId); }, [jumpToMessage, targetMessageId]);

  const warmVisibleMedia = useCallback(({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
    const pending: string[] = [];
    for (const token of viewableItems) {
      if (!token.isViewable || !token.item) continue;
      for (const attachment of renderableAttachments(token.item.attachments)) {
        const candidates = attachment.kind === "image"
          ? [attachment.thumbnailUrl, attachment.url]
          : attachment.kind === "video"
            ? [attachment.thumbnailUrl]
            : [];
        for (const uri of candidates) {
          if (!uri || warmedMediaUris.current.has(uri)) continue;
          warmedMediaUris.current.add(uri);
          pending.push(uri);
        }
      }
    }
    if (pending.length > 0) void prefetchAuthorizedMedia(pending.slice(0, 18)).catch(() => false);
  }, []);

  const revealOlderMessages = useCallback(async () => {
    if (!userDraggedHistory.current || loadingOlder.current) return;
    userDraggedHistory.current = false;
    if (renderLimit < displayMessages.length) {
      setRenderLimit((current) => Math.min(displayMessages.length, current + MESSAGE_PAGE_SIZE));
      return;
    }
    loadingOlder.current = true;
    try {
      await loadOlderMessages(streamId);
      const available = visibleMessages(useAppStore.getState().messages[streamId] ?? []).length;
      setRenderLimit((current) => Math.min(available, current + MESSAGE_PAGE_SIZE));
    } catch {
      showDialog(t("requestFailed"), t("tryAgain"));
    } finally {
      loadingOlder.current = false;
    }
  }, [displayMessages.length, loadOlderMessages, renderLimit, streamId]);

  const recordFirstPaint = useCallback(() => {
    if (firstPaintRecorded.current || openedAt === undefined) return;
    firstPaintRecorded.current = true;
    recordPerformance(chatOpenPerformanceKind(cachedMessageCountAtOpen.current), performance.now() - openedAt, { cachedMessages: cachedMessageCountAtOpen.current });
  }, [openedAt]);

  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const previous = renderedMessages[index - 1];
    const showDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(item.createdAt).toDateString();
    const groupedWithPrevious = !showDay && previous?.sender.id === item.sender.id && item.createdAt - previous.createdAt <= 5 * 60_000;
    const showSender = (streamKind === "channel" || isGroup) && !groupedWithPrevious;
    const showUnread = unreadBoundary.current.sequence === item.sequence;
    return (
      <View>
        {showUnread ? <ChatUnreadDivider /> : null}
        {showDay ? <ChatDayDivider timestamp={item.createdAt} /> : null}
        <SwipeReplyRow
          disabled={selectionMode || Boolean(item.pending || item.failed || item.activity)}
          onReply={() => { onReply(item); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); }}
        >
          <ContentFailureBoundary contentKey={`${item.id}:${item.revision ?? 0}`} domain={item.activity ? "activity" : "message"}>
            <MessageBubble
              streamId={streamId}
              message={item}
              mine={item.sender.id === meId}
              showSender={showSender}
              variant={streamKind === "channel" ? "channel" : "bubble"}
              selected={selectedIds.has(item.id)}
              selectionMode={selectionMode}
              selectionProgress={selectionProgress}
              onPress={() => onToggleSelection(item)}
              onLongPress={() => {
                if (!selectedIds.has(item.id)) onToggleSelection(item);
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
              }}
              onOpenReactions={(anchorY) => onOpenReactions(item, anchorY)}
              onReplyPress={(messageId) => void jumpToMessage(messageId)}
              onReact={(emoji) => void toggleReaction(item, emoji).catch(() => showDialog(t("requestFailed"), t("tryAgain")))}
              onOpenActivity={() => onOpenActivity(item)}
            />
          </ContentFailureBoundary>
        </SwipeReplyRow>
      </View>
    );
  }, [isGroup, jumpToMessage, meId, onOpenActivity, onOpenReactions, onReply, onToggleSelection, renderedMessages, selectedIds, selectionMode, selectionProgress, showDialog, streamId, streamKind, t, toggleReaction]);

  return (
    <View testID="chat_timeline" style={styles.viewport}>
      <FlashList
        ref={list}
        data={renderedMessages}
        keyExtractor={messageKey}
        getItemType={messageCellType}
        renderItem={renderMessage}
        style={styles.list}
        contentContainerStyle={styles.content}
        drawDistance={360}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={maintainVisibleMessagePosition}
        onViewableItemsChanged={warmVisibleMedia}
        onScrollBeginDrag={() => { userDraggedHistory.current = true; }}
        onStartReached={() => void revealOlderMessages().catch(() => undefined)}
        onStartReachedThreshold={0.2}
        onLoad={recordFirstPaint}
        ListEmptyComponent={historyState === "error"
          ? <View style={styles.empty}><Text style={[styles.emptyTitle, { color: palette.text }]}>{title}</Text><Text style={[styles.emptyText, { color: palette.secondaryText }]}>{t("tryAgain")}</Text><Pressable accessibilityRole="button" onPress={() => void refreshHistory()} style={[styles.retry, { backgroundColor: palette.accent }]}><Text style={[styles.retryText, { color: palette.onAccent }]}>{t("tryAgain")}</Text></Pressable></View>
          : historyState !== "ready"
            ? <View style={styles.empty}><ActivityIndicator color={palette.accent} /></View>
            : <View style={styles.empty}><Text style={[styles.emptyTitle, { color: palette.text }]}>{title}</Text><Text style={[styles.emptyText, { color: palette.secondaryText }]}>{t("noMessages")}</Text></View>}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: "hidden" },
  list: { flex: 1 },
  content: { paddingVertical: 8 },
  empty: { alignItems: "center", paddingTop: 90, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, fontWeight: "800" },
  emptyText: { fontSize: 14, marginTop: 6 },
  retry: { minWidth: 132, height: 44, marginTop: 16, paddingHorizontal: 18, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  retryText: { fontSize: 15, fontWeight: "800" },
});
