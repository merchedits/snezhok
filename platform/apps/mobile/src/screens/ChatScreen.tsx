import { AppIcon, type AppIconName } from "../components/AppIcon";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, PanResponder, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppSettings, CooperativeActivityType, Message, UploadQuality, UserSummary } from "@snezhok/contracts";

import { AttachmentSheet } from "../components/AttachmentSheet";
import { useAppDialog } from "../components/AppDialogProvider";
import { Avatar } from "../components/Avatar";
import { ForwardPickerModal } from "../components/ForwardPickerModal";
import { MessageBubble } from "../components/MessageBubble";
import { PlayfulBackdrop } from "../components/PlayfulBackdrop";
import { MessageSearchModal } from "../components/MessageSearchModal";
import { ReactionPicker } from "../components/ReactionPicker";
import { ScreenHeader } from "../components/ScreenHeader";
import { ScheduledMessagesModal } from "../components/ScheduledMessagesModal";
import { ActivityLauncherSheet } from "../components/ActivityLauncherSheet";
import { CooperativeActivityModal } from "../components/CooperativeActivityModal";
import { SwipeReplyRow } from "../components/SwipeReplyRow";
import { TypingIndicator } from "../components/TypingIndicator";
import { usePalette } from "../hooks/usePalette";
import { useUiPreferences } from "../hooks/useUiPreferences";
import { useTranslation } from "../i18n";
import { recordDiagnostic, recordPerformance } from "../diagnostics/diagnostics";
import { composerBottomPadding } from "../lib/keyboardLayout";
import { renderableAttachments } from "../lib/messagePayload";
import { activeMentionQuery, insertMention, mentionSuggestions } from "../lib/mentionAutocomplete";
import { selectedMessageText } from "../lib/messageSelection";
import { isUploadCancelled } from "../lib/uploadPolicy";
import { userFacingError } from "../lib/userFacingError";
import { dismissMessageNotifications } from "../notifications/androidNotifications";
import { emitRealtimeTyping, joinRealtimeStream, leaveRealtimeStream } from "../lib/realtimeBridge";
import { appendRecordingLevel, recordingSourceForMicrophone, routeThroughEarpieceForMicrophone } from "../lib/recordingWaveform";
import { voiceGestureDecision } from "../lib/voiceRecordingGesture";
import { clearVoicePlaybackQueue, setVoicePlaybackQueue } from "../lib/voicePlaybackCoordinator";
import { visibleMessages } from "../store/messageReconciliation";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList, UploadInput } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

const maintainVisibleMessagePosition = { startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 } as const;
const INITIAL_RENDERED_MESSAGES = 80;
const MESSAGE_PAGE_SIZE = 60;
const FIRST_FRAME_MESSAGES = 10;
const emptyMessages: Message[] = [];
const messageKey = (message: Message) => message.id;
const messageCellType = (message: Message) => {
  if (message.activity) return `activity-${message.activity.type}`;
  const attachments = renderableAttachments(message.attachments);
  if (message.kind === "voice" || attachments.some((attachment) => attachment.kind === "audio")) return "voice";
  if (attachments.some((attachment) => attachment.kind === "image" || attachment.kind === "video")) return "media";
  return message.kind;
};
type VoiceRecordCommand = "idle" | "holding" | "locked" | "finish" | "cancel";

export function ChatScreen({ navigation, route }: Props) {
  const { streamId, streamKind, title } = route.params;
  const palette = usePalette();
  const ui = useUiPreferences();
  const { t, language } = useTranslation();
  const showDialog = useAppDialog();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const list = useRef<FlashListRef<Message>>(null);
  const messages = useAppStore((state) => state.messages[streamId] ?? emptyMessages);
  const me = useAppStore((state) => state.me);
  const conversation = useAppStore((state) => state.conversations.find((item) => item.id === streamId));
  const channel = useAppStore((state) => state.channels.find((item) => item.id === streamId));
  const peer = conversation?.saved ? undefined : conversation?.participants.find((participant) => participant.id !== me?.id) ?? conversation?.participants[0];
  const isGroup = conversation?.kind === "group";
  const online = useAppStore((state) => state.online);
  const loadMessages = useAppStore((state) => state.loadMessages);
  const loadOlderMessages = useAppStore((state) => state.loadOlderMessages);
  const loadMessageContext = useAppStore((state) => state.loadMessageContext);
  const markStreamRead = useAppStore((state) => state.markStreamRead);
  const loadPinnedMessages = useAppStore((state) => state.loadPinnedMessages);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const forwardMessage = useAppStore((state) => state.forwardMessage);
  const editMessage = useAppStore((state) => state.editMessage);
  const toggleReaction = useAppStore((state) => state.toggleReaction);
  const deleteMessage = useAppStore((state) => state.deleteMessage);
  const setMessagePinned = useAppStore((state) => state.setMessagePinned);
  const createActivity = useAppStore((state) => state.createActivity);
  const sendAttachmentBatch = useAppStore((state) => state.sendAttachmentBatch);
  const cancelUpload = useAppStore((state) => state.cancelUpload);
  const uploadProgress = useAppStore((state) => state.uploadProgress);
  const uploadQuality = useAppStore((state) => state.settings.defaultUploadQuality);
  const microphoneMode = useAppStore((state) => state.settings.microphoneMode);
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const draft = useAppStore((state) => state.drafts[streamId] ?? "");
  const setDraft = useAppStore((state) => state.setDraft);
  const scheduleTextMessage = useAppStore((state) => state.scheduleTextMessage);
  // Zustand selectors must return a stable snapshot. Filtering inside the
  // selector creates a new array on every read and React 19 treats that as an
  // endless external-store update, which crashed chats containing messages.
  const allScheduledMessages = useAppStore((state) => state.scheduledMessages);
  const scheduledMessages = useMemo(() => allScheduledMessages.filter((item) => item.streamId === streamId), [allScheduledMessages, streamId]);
  const cancelScheduledMessage = useAppStore((state) => state.cancelScheduledMessage);
  const [text, setText] = useState(draft);
  const [recorderMounted, setRecorderMounted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingLevels, setRecordingLevels] = useState<number[]>([]);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [voiceCommand, setVoiceCommand] = useState<VoiceRecordCommand>("idle");
  const [attachmentSheet, setAttachmentSheet] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [forwardPicker, setForwardPicker] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [reactionTarget, setReactionTarget] = useState<{ message: Message; anchorY: number } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [scheduledVisible, setScheduledVisible] = useState(false);
  const [cancellingScheduledId, setCancellingScheduledId] = useState<string | null>(null);
  const [activityLauncher, setActivityLauncher] = useState(false);
  const [creatingActivity, setCreatingActivity] = useState(false);
  const [activeActivityMessage, setActiveActivityMessage] = useState<Message | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  const [composerSelection, setComposerSelection] = useState({ start: draft.length, end: draft.length });
  const [routeSettled, setRouteSettled] = useState(false);
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDERED_MESSAGES);
  const [listReady, setListReady] = useState(false);
  const selectionProgress = useSharedValue(0);
  const selectionMode = selectedIds.size > 0;
  const initialPositioned = useRef(false);
  const userDraggedHistory = useRef(false);
  const loadingOlder = useRef(false);
  const firstPaintRecorded = useRef(false);
  const cachedMessageCountAtOpen = useRef(messages.length);
  const draftBeforeEdit = useRef("");
  const typingActive = useRef(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceCommandRef = useRef<VoiceRecordCommand>("idle");
  voiceCommandRef.current = voiceCommand;
  const unreadBoundary = useRef<{ streamId: string; initialCount: number; sequence: number | null }>({
    streamId,
    initialCount: Math.max(conversation?.unreadCount ?? 0, channel?.unreadCount ?? 0),
    sequence: null,
  });

  if (unreadBoundary.current.streamId !== streamId) {
    unreadBoundary.current = {
      streamId,
      initialCount: Math.max(conversation?.unreadCount ?? 0, channel?.unreadCount ?? 0),
      sequence: null,
    };
  }

  useEffect(() => {
    selectionProgress.value = withTiming(selectionMode ? 1 : 0, {
      duration: reducedMotion ? 0 : 160,
      easing: Easing.out(Easing.cubic),
    });
  }, [reducedMotion, selectionMode, selectionProgress]);

  useEffect(() => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      setRouteSettled(true);
    };
    const unsubscribe = navigation.addListener("transitionEnd", (event) => {
      if (!event.data.closing) settle();
    });
    const fallback = setTimeout(settle, 600);
    return () => {
      clearTimeout(fallback);
      unsubscribe();
    };
  }, [navigation, streamId]);

  useEffect(() => {
    if (!routeSettled) return;
    void Promise.all([loadMessages(streamId), loadPinnedMessages(streamId)]).catch(() => undefined);
  }, [loadMessages, loadPinnedMessages, routeSettled, streamId]);
  useEffect(() => {
    if (!isFocused || !routeSettled) return;
    joinRealtimeStream(streamId);
    return () => {
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
      typingStopTimer.current = null;
      if (typingActive.current) emitRealtimeTyping(streamId, false);
      typingActive.current = false;
      leaveRealtimeStream(streamId);
    };
  }, [isFocused, routeSettled, streamId]);
  useEffect(() => {
    setSelectedIds(new Set());
    setForwardPicker(false);
    setReactionTarget(null);
    setReplyingTo(null);
    setEditingMessage(null);
    setText(useAppStore.getState().drafts[streamId] ?? "");
    const nextDraft = useAppStore.getState().drafts[streamId] ?? "";
    setComposerSelection({ start: nextDraft.length, end: nextDraft.length });
    setVoiceCommand("idle");
    setRecorderMounted(false);
    setRecording(false);
    initialPositioned.current = false;
    userDraggedHistory.current = false;
    loadingOlder.current = false;
    firstPaintRecorded.current = false;
    cachedMessageCountAtOpen.current = useAppStore.getState().messages[streamId]?.length ?? 0;
    setRouteSettled(false);
    setRenderLimit(INITIAL_RENDERED_MESSAGES);
    setListReady(false);
  }, [streamId]);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);

  // Store reconciliation already maintains chronological order. Avoid copying,
  // sorting and reversing the entire history during the first navigation frame.
  const displayMessages = useMemo(() => visibleMessages(messages), [messages]);
  if (unreadBoundary.current.sequence === null && unreadBoundary.current.initialCount > 0 && displayMessages.length > 0) {
    const boundaryIndex = Math.max(0, displayMessages.length - unreadBoundary.current.initialCount);
    unreadBoundary.current.sequence = displayMessages[boundaryIndex]?.sequence ?? null;
  }
  const renderedMessages = useMemo(() => displayMessages.slice(-renderLimit), [displayMessages, renderLimit]);
  const sorted = displayMessages;
  const selectedMessages = useMemo(() => sorted.filter((message) => selectedIds.has(message.id)), [selectedIds, sorted]);
  const clipboardText = useMemo(() => selectedMessageText(selectedMessages), [selectedMessages]);
  const latestSequence = useMemo(() => messages.reduce((maximum, message) => Math.max(maximum, message.sequence), 0), [messages]);
  const latestPin = useMemo(() => {
    let latest: Message | undefined;
    for (const message of messages) {
      if (!message.pinnedAt || message.deletedAt) continue;
      if (!latest || message.pinnedAt > (latest.pinnedAt ?? 0)) latest = message;
    }
    return latest;
  }, [messages]);
  const typingParticipants = useMemo(() => {
    const users = new Map<string, NonNullable<typeof me>>();
    for (const participant of conversation?.participants ?? []) users.set(participant.id, participant);
    for (const participant of channel?.connectedMembers ?? []) users.set(participant.id, participant);
    for (const message of messages) users.set(message.sender.id, message.sender);
    if (me) users.delete(me.id);
    return [...users.values()];
  }, [channel?.connectedMembers, conversation?.participants, me, messages]);
  const voiceAttachmentIds = useMemo(() => displayMessages.flatMap((message) => renderableAttachments(message.attachments)
    .filter((attachment) => attachment.kind === "audio")
    .map((attachment) => attachment.id)), [displayMessages]);
  const voiceAttachmentKey = voiceAttachmentIds.join(",");
  const mentionQuery = useMemo(() => streamKind === "channel" || isGroup
    ? activeMentionQuery(text, composerSelection.end)
    : null, [composerSelection.end, isGroup, streamKind, text]);
  const suggestedMentions = useMemo(() => mentionQuery
    ? mentionSuggestions(typingParticipants, mentionQuery.query, me?.id)
    : [], [me?.id, mentionQuery, typingParticipants]);

  useEffect(() => {
    setVoicePlaybackQueue(streamId, voiceAttachmentIds);
    // The compact key avoids rerunning the effect when message reconciliation
    // returns a new array containing the same ordered voice-note queue.
  }, [streamId, voiceAttachmentKey]);
  useEffect(() => () => clearVoicePlaybackQueue(streamId), [streamId]);

  useEffect(() => {
    if (!isFocused || !routeSettled || latestSequence <= 0) return;
    void markStreamRead(streamId, latestSequence).catch(() => undefined);
  }, [isFocused, latestSequence, markStreamRead, routeSettled, streamId]);
  useEffect(() => {
    if (isFocused && routeSettled) void dismissMessageNotifications(streamId).catch(() => undefined);
  }, [isFocused, routeSettled, streamId]);

  const recordFirstPaint = useCallback(() => {
    if (firstPaintRecorded.current || route.params.openedAt === undefined) return;
    firstPaintRecorded.current = true;
    recordPerformance(cachedMessageCountAtOpen.current > 0 ? "cachedChatOpen" : "warmChatOpen", performance.now() - route.params.openedAt, {
      cachedMessages: cachedMessageCountAtOpen.current,
    });
  }, [route.params.openedAt]);

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

  const jumpToPinned = useCallback(() => {
    if (latestPin) void jumpToMessage(latestPin.id);
  }, [jumpToMessage, latestPin]);

  useEffect(() => {
    if (route.params.targetMessageId) void jumpToMessage(route.params.targetMessageId);
  }, [jumpToMessage, route.params.targetMessageId]);

  const toggleSelected = useCallback((message: Message) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });
  }, []);

  const stopTyping = useCallback(() => {
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = null;
    if (!typingActive.current) return;
    typingActive.current = false;
    emitRealtimeTyping(streamId, false);
  }, [streamId]);

  const handleTextChange = useCallback((value: string) => {
    setText(value);
    if (!editingMessage) setDraft(streamId, value);
    if (!value.trim() || editingMessage || !online) {
      stopTyping();
      return;
    }
    if (!typingActive.current) {
      typingActive.current = true;
      emitRealtimeTyping(streamId, true);
    }
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(stopTyping, 4_000);
  }, [editingMessage, online, setDraft, stopTyping, streamId]);

  const chooseMention = useCallback((username: string) => {
    if (!mentionQuery) return;
    const inserted = insertMention(text, mentionQuery, username);
    handleTextChange(inserted.text);
    setComposerSelection({ start: inserted.caret, end: inserted.caret });
  }, [handleTextChange, mentionQuery, text]);

  const sendText = async (silent = false) => {
    const value = text.trim();
    if (!value) return;
    stopTyping();
    if (editingMessage) {
      const restoringDraft = draftBeforeEdit.current;
      setText(restoringDraft);
      setComposerSelection({ start: restoringDraft.length, end: restoringDraft.length });
      setEditingMessage(null);
      await editMessage(editingMessage, value);
      return;
    }
    setText("");
    setComposerSelection({ start: 0, end: 0 });
    setDraft(streamId, "");
    const replyToId = replyingTo?.id ?? null;
    setReplyingTo(null);
    await sendMessage(streamId, { text: value, kind: "text", replyToId, attachmentIds: [], silent });
    void Haptics.selectionAsync().catch(() => undefined);
  };

  const scheduleText = async (delayMs: number) => {
    const value = text.trim();
    if (!value || editingMessage) return;
    setText("");
    setComposerSelection({ start: 0, end: 0 });
    setDraft(streamId, "");
    const replyToId = replyingTo?.id ?? null;
    setReplyingTo(null);
    await scheduleTextMessage(streamId, { text: value, kind: "text", replyToId, attachmentIds: [], silent: false }, Date.now() + delayMs);
  };

  const handleUploads = useCallback(async (inputs: UploadInput[], messageKind: "media" | "file" | "video-note" | "voice" = "media") => {
    if (!inputs.length) return;
    if (!online) return showDialog(t("offline"), t("attachmentOnline"));
    setUploading(true);
    try {
      const replyToId = replyingTo?.id ?? null;
      await sendAttachmentBatch(streamId, inputs, messageKind, replyToId);
      setReplyingTo(null);
      setAttachmentSheet(false);
    } catch (error) {
      if (!isUploadCancelled(error)) {
        showDialog(t("uploadFailed"), userFacingError(error, t), [
          { text: t("cancel"), style: "cancel" },
          { text: t("retry"), onPress: () => void handleUploads(inputs, messageKind) },
        ]);
      }
    } finally {
      setUploading(false);
    }
  }, [online, replyingTo?.id, sendAttachmentBatch, streamId, t]);

  const handleUpload = useCallback(async (input: UploadInput, messageKind: "media" | "file" | "video-note" | "voice" = "media") => {
    await handleUploads([input], messageKind);
  }, [handleUploads]);

  const updateVoiceCommand = useCallback((command: VoiceRecordCommand) => {
    voiceCommandRef.current = command;
    setVoiceCommand(command);
  }, []);

  const beginRecording = async () => {
    if (!online) {
      updateVoiceCommand("idle");
      return showDialog(t("offline"), t("voiceOnline"));
    }
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        updateVoiceCommand("idle");
        return showDialog(t("microphoneRequired"), t("allowMicrophone"));
      }
      if (voiceCommandRef.current === "cancel" || voiceCommandRef.current === "idle") {
        updateVoiceCommand("idle");
        return;
      }
    } catch (error) {
      updateVoiceCommand("idle");
      return showDialog(t("microphoneRequired"), userFacingError(error, t));
    }
    setRecorderMounted(true);
  };

  const startVoiceRecording = () => {
    if (uploading || recording || voiceCommandRef.current !== "idle") return;
    setRecordingLevels([]);
    setRecordingDuration(0);
    updateVoiceCommand("holding");
    void beginRecording();
  };

  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const previous = renderedMessages[index - 1];
    const showDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(item.createdAt).toDateString();
    const groupedWithPrevious = !showDay && previous?.sender.id === item.sender.id && item.createdAt - previous.createdAt <= 5 * 60_000;
    const showSender = (streamKind === "channel" || isGroup) && !groupedWithPrevious;
    const showUnread = unreadBoundary.current.sequence === item.sequence;
    return <View>
      {showUnread ? <UnreadDivider /> : null}
      {showDay ? <View style={styles.day}><View style={[styles.dayLine, { backgroundColor: palette.border }]} /><Text style={[styles.dayText, { color: palette.secondaryText }]}>{new Date(item.createdAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</Text><View style={[styles.dayLine, { backgroundColor: palette.border }]} /></View> : null}
      <SwipeReplyRow disabled={selectionMode || Boolean(item.pending || item.failed || item.activity)} onReply={() => { setReplyingTo(item); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); }}>
        <MessageBubble streamId={streamId} message={item} mine={item.sender.id === me?.id} showSender={showSender} variant={streamKind === "channel" ? "channel" : "bubble"} selected={selectedIds.has(item.id)} selectionMode={selectionMode} selectionProgress={selectionProgress} onPress={() => toggleSelected(item)} onLongPress={() => { if (!selectedIds.has(item.id)) toggleSelected(item); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); }} onOpenReactions={(anchorY) => setReactionTarget({ message: item, anchorY })} onReplyPress={(messageId) => void jumpToMessage(messageId)} onReact={(emoji) => void toggleReaction(item, emoji).catch(() => showDialog(t("requestFailed"), t("tryAgain")))} onOpenActivity={() => setActiveActivityMessage(item)} />
      </SwipeReplyRow>
    </View>;
  }, [isGroup, jumpToMessage, me?.id, palette.border, palette.secondaryText, renderedMessages, selectedIds, selectionMode, selectionProgress, streamId, streamKind, t, toggleReaction, toggleSelected]);

  const startActivity = useCallback(async (type: CooperativeActivityType, options: Record<string, unknown> = {}) => {
    if (creatingActivity) return;
    setCreatingActivity(true);
    try {
      const message = await createActivity(streamId, type, options);
      setActivityLauncher(false);
      setActiveActivityMessage(message);
      requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (error) {
      showDialog(t("requestFailed"), userFacingError(error, t));
    } finally { setCreatingActivity(false); }
  }, [createActivity, creatingActivity, showDialog, streamId, t]);

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
    } finally {
      loadingOlder.current = false;
    }
  }, [displayMessages.length, loadOlderMessages, renderLimit, streamId]);

  const firstFrameMessages = useMemo(() => renderedMessages.slice(-FIRST_FRAME_MESSAGES), [renderedMessages]);
  const firstFrameStart = renderedMessages.length - firstFrameMessages.length;

  const emptyState = useMemo(() => <View style={styles.empty}><Text style={[styles.emptyTitle, { color: palette.text }]}>{title}</Text><Text style={[styles.emptyText, { color: palette.secondaryText }]}>{t("noMessages")}</Text></View>, [palette.secondaryText, palette.text, t, title]);

  const performForward = useCallback(async (targetStreamId: string) => {
    const messagesToForward = selectedMessages;
    setForwardPicker(false);
    setSelectedIds(new Set());
    setForwarding(true);
    try {
      await Promise.all(messagesToForward.map((message) => forwardMessage(message.id, targetStreamId)));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch {
      showDialog(t("requestFailed"), t("tryAgain"));
    } finally {
      setForwarding(false);
    }
  }, [forwardMessage, selectedMessages, t]);

  const closeAttachmentSheet = useCallback(() => setAttachmentSheet(false), []);
  const closeForwardPicker = useCallback(() => {
    if (!forwarding) setForwardPicker(false);
  }, [forwarding]);
  const selectForwardTarget = useCallback((target: { id: string }) => {
    void performForward(target.id);
  }, [performForward]);

  const confirmDeleteSelected = () => {
    const remove = async (scope: "me" | "everyone") => {
      const messagesToDelete = selectedMessages;
      setSelectedIds(new Set());
      try {
        await Promise.all(messagesToDelete.map((message) => deleteMessage(message, scope)));
      } catch (error) {
        showDialog(t("requestFailed"), userFacingError(error, t));
      }
    };
    const canDeleteForEveryone = selectedMessages.every((message) => message.sender.id === me?.id)
      || (streamKind === "conversation" && !isGroup);
    showDialog(
      t("deleteMessagesTitle", { count: selectedMessages.length }),
      t("deleteMessagesAudience"),
      [
        { text: t("cancel"), style: "cancel" },
        { text: t("deleteForMe"), onPress: () => void remove("me") },
        ...(canDeleteForEveryone ? [{ text: t("deleteForEveryone"), style: "destructive" as const, onPress: () => void remove("everyone") }] : []),
      ],
    );
  };

  const toggleSelectedPins = async () => {
    const eligible = selectedMessages.filter((message) => !message.pending && !message.failed);
    if (!eligible.length) return;
    const pinned = !eligible.every((message) => Boolean(message.pinnedAt));
    setSelectedIds(new Set());
    try {
      await Promise.all(eligible.map((message) => setMessagePinned(message, pinned)));
    } catch (error) {
      showDialog(t("requestFailed"), userFacingError(error, t));
    }
  };

  const copySelected = async () => {
    if (!clipboardText) return;
    setSelectedIds(new Set());
    await Clipboard.setStringAsync(clipboardText);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  };

  const editableMessage = selectedMessages.length === 1
    ? selectedMessages[0]?.sender.id === me?.id && selectedMessages[0]?.kind === "text" && !selectedMessages[0]?.pending && !selectedMessages[0]?.failed
      ? selectedMessages[0]
      : null
    : null;

  const beginEditing = () => {
    if (!editableMessage) return;
    draftBeforeEdit.current = useAppStore.getState().drafts[streamId] ?? "";
    setEditingMessage(editableMessage);
    setText(editableMessage.text);
    setComposerSelection({ start: editableMessage.text.length, end: editableMessage.text.length });
    setSelectedIds(new Set());
  };

  const cancelEditing = () => {
    setEditingMessage(null);
    setText(draftBeforeEdit.current);
    setComposerSelection({ start: draftBeforeEdit.current.length, end: draftBeforeEdit.current.length });
  };

  const activeReactionEmojis = useMemo(() => new Set(
    reactionTarget?.message.reactions.filter((reaction) => reaction.reacted).map((reaction) => reaction.emoji) ?? [],
  ), [reactionTarget]);

  const selectReaction = useCallback((emoji: string) => {
    const target = reactionTarget;
    setReactionTarget(null);
    if (!target) return;
    void Haptics.selectionAsync().catch(() => undefined);
    void toggleReaction(target.message, emoji).catch(() => showDialog(t("requestFailed"), t("tryAgain")));
  }, [reactionTarget, t, toggleReaction]);

  const showSendOptions = () => {
    if (!text.trim() || editingMessage) return;
    showDialog(t("sendOptions"), undefined, [
      { text: t("cancel"), style: "cancel" },
      { text: t("sendSilently"), onPress: () => void sendText(true) },
      { text: t("schedule15Minutes"), onPress: () => void scheduleText(15 * 60_000).catch(() => showDialog(t("requestFailed"), t("tryAgain"))) },
      { text: t("scheduleOneHour"), onPress: () => void scheduleText(60 * 60_000).catch(() => showDialog(t("requestFailed"), t("tryAgain"))) },
      { text: t("scheduleTomorrow"), onPress: () => void scheduleText(24 * 60 * 60_000).catch(() => showDialog(t("requestFailed"), t("tryAgain"))) },
    ]);
  };

  return (
    <KeyboardAvoidingView onLayout={recordFirstPaint} style={[styles.screen, { backgroundColor: palette.chatCanvas }]} behavior="height" automaticOffset keyboardVerticalOffset={0}>
      <PlayfulBackdrop variant="chat" />
      {selectedIds.size > 0
        ? <ScreenHeader tone="chat" title={String(selectedIds.size)} left={{ icon: "close", label: t("cancel"), onPress: () => setSelectedIds(new Set()) }} />
        : <ScreenHeader tone="chat" title={title} {...(route.params.subtitle ? { subtitle: route.params.subtitle } : {})} left={{ icon: "chevron-back", label: t("back"), onPress: navigation.goBack }} center={peer ? <Pressable onPress={() => navigation.navigate("Profile", { userId: peer.id })} style={styles.headerIdentity} accessibilityRole="button"><Avatar uri={peer.avatarUrl} label={peer.displayName} color={peer.avatarColor} online={peer.presence === "online"} size={34} /><View style={styles.headerCopy}><Text numberOfLines={1} style={[styles.headerTitle, { color: palette.text, fontSize: ui.font(15) }]}>{peer.displayName}</Text><Text numberOfLines={1} style={[styles.headerSubtitle, { color: peer.presence === "online" ? palette.success : palette.secondaryText, fontSize: ui.font(11) }]}>{peer.presence === "online" ? t("online") : t("lastSeen", { date: formatLastSeen(peer.lastSeenAt) })}</Text></View></Pressable> : undefined} right={[...(conversation?.kind === "direct" && !conversation.saved ? [{ icon: "sparkles-outline" as const, label: language === "ru" ? "Сделать вместе" : "Do something together", onPress: () => setActivityLauncher(true) }] : []), ...(scheduledMessages.length ? [{ icon: "time-outline" as const, label: t("scheduledMessages"), onPress: () => setScheduledVisible(true) }] : []), ...(streamKind === "conversation" ? [{ icon: "call-outline" as const, label: t("startCall"), onPress: () => navigation.navigate("Call", { streamId, title }) }] : []), { icon: "search", label: t("search"), onPress: () => setSearchVisible(true) }]} />}
      {latestPin ? <Pressable onPress={jumpToPinned} style={({ pressed }) => [styles.pinBanner, { borderColor: palette.outline, backgroundColor: pressed ? palette.accentSoft : palette.moment.butter }]}><View style={[styles.pinAccent, { backgroundColor: palette.accent }]} /><AppIcon name="pin" size={17} color={palette.accent} /><View style={styles.pinCopy}><Text style={[styles.pinLabel, { color: palette.accent }]}>{t("pinnedMessage")}</Text><Text numberOfLines={1} style={[styles.pinText, { color: palette.secondaryText }]}>{latestPin.text || t("attachment")}</Text></View></Pressable> : null}
      <View style={styles.messageViewport}>
        <FlashList ref={list} data={renderedMessages} keyExtractor={messageKey} getItemType={messageCellType} renderItem={renderMessage} style={styles.messageList} contentContainerStyle={styles.list} drawDistance={360} keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} keyboardShouldPersistTaps="handled" maintainVisibleContentPosition={maintainVisibleMessagePosition} onScrollBeginDrag={() => { userDraggedHistory.current = true; }} onStartReached={() => void revealOlderMessages().catch(() => undefined)} onStartReachedThreshold={0.2} onLoad={() => setListReady(true)} onContentSizeChange={() => { if (!initialPositioned.current && renderedMessages.length) { initialPositioned.current = true; requestAnimationFrame(() => list.current?.scrollToEnd({ animated: false })); } }} ListEmptyComponent={emptyState} />
        {!listReady && firstFrameMessages.length ? <View pointerEvents="none" style={[styles.firstFrameMessages, { backgroundColor: palette.chatCanvas }]}>
          {firstFrameMessages.map((message, index) => <View key={message.id}>{renderMessage({ item: message, index: firstFrameStart + index })}</View>)}
        </View> : null}
      </View>
      {selectedIds.size > 0 ? <View style={[styles.selectionToolbar, { paddingBottom: Math.max(insets.bottom, 8), borderColor: palette.outline, backgroundColor: palette.composer }]}>
        {clipboardText ? <SelectionAction icon="copy-outline" label={t("copy")} onPress={() => void copySelected()} /> : null}
        <SelectionAction icon="return-up-forward-outline" label={t("forward")} onPress={() => setForwardPicker(true)} />
        <SelectionAction icon={selectedMessages.every((message) => Boolean(message.pinnedAt)) ? "pin-outline" : "pin"} label={t(selectedMessages.every((message) => Boolean(message.pinnedAt)) ? "unpinAction" : "pinAction")} onPress={() => void toggleSelectedPins()} />
        <SelectionAction danger icon="trash-outline" label={t("deleteAction")} onPress={confirmDeleteSelected} />
      </View> : <>
        <TypingIndicator streamId={streamId} participants={typingParticipants} reducedMotion={reducedMotion} />
        {suggestedMentions.length ? <MentionSuggestions participants={suggestedMentions} onSelect={chooseMention} /> : null}
        {recording ? <RecordingStatus levels={recordingLevels} durationMillis={recordingDuration} locked={voiceCommand === "locked"} /> : null}
        {editingMessage ? <View style={[styles.replyComposer, { backgroundColor: palette.surface, borderColor: palette.border }]}><View style={[styles.replyAccent, { backgroundColor: palette.accent }]} /><View style={styles.replyCopy}><Text style={[styles.replyName, { color: palette.accent }]}>{t("editMessage")}</Text><Text numberOfLines={1} style={[styles.replyText, { color: palette.secondaryText }]}>{editingMessage.text}</Text></View><Pressable onPress={cancelEditing} style={styles.replyClose}><AppIcon name="close" size={21} color={palette.secondaryText} /></Pressable></View> : replyingTo ? <View style={[styles.replyComposer, { backgroundColor: palette.surface, borderColor: palette.border }]}><View style={[styles.replyAccent, { backgroundColor: palette.accent }]} /><View style={styles.replyCopy}><Text numberOfLines={1} style={[styles.replyName, { color: palette.accent }]}>{replyingTo.sender.displayName}</Text><Text numberOfLines={1} style={[styles.replyText, { color: palette.secondaryText }]}>{replyingTo.text || t("attachment")}</Text></View><Pressable onPress={() => setReplyingTo(null)} style={styles.replyClose}><AppIcon name="close" size={21} color={palette.secondaryText} /></Pressable></View> : null}
        <View style={[styles.composer, { minHeight: ui.dense(58, 52), borderColor: palette.outline, backgroundColor: palette.composer, paddingBottom: composerBottomPadding(insets.bottom, keyboardVisible) }]}>
          {voiceCommand === "locked" ? <Pressable onPress={() => updateVoiceCommand("cancel")} style={styles.composerButton} accessibilityLabel={t("cancel")}><AppIcon name="trash-outline" size={23} color={palette.danger} /></Pressable> : <Pressable disabled={uploading || voiceCommand !== "idle"} onPress={() => setAttachmentSheet(true)} style={styles.composerButton} accessibilityLabel={t("attachFile")}><AppIcon name="add-circle-outline" size={27} color={uploading || voiceCommand !== "idle" ? palette.faintText : palette.accent} /></Pressable>}
          <View style={[styles.inputWrap, { minHeight: ui.dense(41, 37), borderRadius: Math.max(14, ui.bubbleRadius), backgroundColor: palette.elevated, borderColor: palette.outline }]}><TextInput value={text} selection={composerSelection} onSelectionChange={(event) => setComposerSelection(event.nativeEvent.selection)} onChangeText={handleTextChange} onFocus={() => setKeyboardVisible(true)} editable={!recording} multiline maxLength={16_000} placeholder={recording ? t("recording") : t("message")} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, fontSize: ui.font(16), lineHeight: ui.font(20), paddingVertical: ui.dense(9, 7) }]} /></View>
          {uploading ? <View style={styles.composerButton}><ActivityIndicator color={palette.accent} /></View> : text.trim() ? <Pressable delayLongPress={320} onPress={() => void sendText()} onLongPress={showSendOptions} style={[styles.send, { backgroundColor: palette.accent, borderColor: palette.outline }]} accessibilityLabel={t("sendMessage")}><AppIcon name="arrow-up" size={21} color={palette.onAccent} strokeWidth={2} /></Pressable> : <VoiceGestureButton command={voiceCommand} disabled={uploading} onStart={startVoiceRecording} onLock={() => updateVoiceCommand("locked")} onCancel={() => updateVoiceCommand("cancel")} onFinish={() => updateVoiceCommand("finish")} />}
        </View>
        {recorderMounted ? <VoiceRecorderControl command={voiceCommand} quality={uploadQuality} microphoneMode={microphoneMode} onRecordingChange={setRecording} onMetering={(metering, durationMillis) => { setRecordingLevels((levels) => appendRecordingLevel(levels, metering)); setRecordingDuration(durationMillis); }} onTooShort={() => showDialog(t("voiceMessage"), t("voiceTooShort"))} onCancel={() => { updateVoiceCommand("idle"); setRecording(false); setRecordingLevels([]); setRecordingDuration(0); setRecorderMounted(false); }} onComplete={async (input) => { updateVoiceCommand("idle"); setRecording(false); setRecordingLevels([]); setRecordingDuration(0); setRecorderMounted(false); await handleUpload(input, "voice"); }} /> : null}
      </>}
      <AttachmentSheet visible={attachmentSheet} busy={uploading} progress={uploadProgress} onClose={closeAttachmentSheet} onCancel={() => void cancelUpload()} onSelect={handleUploads} />
      <ReactionPicker visible={Boolean(reactionTarget)} anchorY={reactionTarget?.anchorY ?? 0} activeEmojis={activeReactionEmojis} onClose={() => setReactionTarget(null)} onSelect={selectReaction} />
      <ForwardPickerModal
        visible={forwardPicker}
        busy={forwarding}
        onClose={closeForwardPicker}
        onSelect={selectForwardTarget}
      />
      <MessageSearchModal visible={searchVisible} streamId={streamId} onClose={() => setSearchVisible(false)} onOpenUser={(user) => { setSearchVisible(false); navigation.navigate("Profile", { userId: user.id }); }} onOpenMessage={(message) => { setSearchVisible(false); void jumpToMessage(message.id); }} />
      <ScheduledMessagesModal visible={scheduledVisible} messages={scheduledMessages} cancellingId={cancellingScheduledId} onClose={() => setScheduledVisible(false)} onCancel={(message) => {
        showDialog(t("cancelScheduledMessage"), message.text, [
          { text: t("cancel"), style: "cancel" },
          { text: t("deleteMessage"), style: "destructive", onPress: () => {
            setCancellingScheduledId(message.id);
            void cancelScheduledMessage(message.id).catch(() => showDialog(t("requestFailed"), t("tryAgain"))).finally(() => setCancellingScheduledId(null));
          } },
        ]);
      }} />
      <ActivityLauncherSheet visible={activityLauncher} busy={creatingActivity} onClose={() => { if (!creatingActivity) setActivityLauncher(false); }} onStart={(type, options) => void startActivity(type, options)} />
      <CooperativeActivityModal message={activeActivityMessage ? (messages.find((message) => message.id === activeActivityMessage.id) ?? activeActivityMessage) : null} onClose={() => setActiveActivityMessage(null)} />
    </KeyboardAvoidingView>
  );
}

function VoiceRecorderControl({ command, quality, microphoneMode, onRecordingChange, onMetering, onTooShort, onCancel, onComplete }: { command: VoiceRecordCommand; quality: UploadQuality; microphoneMode: AppSettings["microphoneMode"]; onRecordingChange: (value: boolean) => void; onMetering: (metering: number | undefined, durationMillis: number) => void; onTooShort: () => void; onCancel: () => void; onComplete: (input: UploadInput) => Promise<void> }) {
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const recordingOptions = useMemo(() => ({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
    numberOfChannels: 1,
    android: {
      ...RecordingPresets.HIGH_QUALITY.android,
      audioSource: recordingSourceForMicrophone(microphoneMode),
    },
  }), [microphoneMode]);
  const recorder = useAudioRecorder(recordingOptions);
  const recorderState = useAudioRecorderState(recorder, 80);
  const [started, setStarted] = useState(false);
  const mounted = useRef(true);
  const finishing = useRef(false);
  const duration = useRef(0);
  const onMeteringRef = useRef(onMetering);
  const callbacks = useRef({ onCancel, onComplete, onRecordingChange, onTooShort });
  onMeteringRef.current = onMetering;
  callbacks.current = { onCancel, onComplete, onRecordingChange, onTooShort };
  duration.current = recorderState.durationMillis;

  useEffect(() => {
    if (started && recorderState.isRecording) onMeteringRef.current(recorderState.metering, recorderState.durationMillis);
  }, [recorderState.durationMillis, recorderState.isRecording, recorderState.metering, started]);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const shouldRouteThroughEarpiece = routeThroughEarpieceForMicrophone(microphoneMode);
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          // Android's speakerphone route is the closest portable way to ask
          // Samsung and other OEMs for their communications microphone path.
          ...(shouldRouteThroughEarpiece !== undefined ? { shouldRouteThroughEarpiece } : {}),
        });
        try {
          await recorder.prepareToRecordAsync();
        } catch (error) {
          // Some Android 12 vendor builds reject VOICE_COMMUNICATION even
          // though they report it as available. Preserve the user's selected
          // route, but retry recording through the standard microphone source
          // rather than tearing down the chat.
          if (microphoneMode !== "speakerphone") throw error;
          recordDiagnostic("warn", "media", "Voice recorder source fallback", { source: "voice_communication" });
          await recorder.prepareToRecordAsync({
            ...recordingOptions,
            android: { ...recordingOptions.android, audioSource: "default" },
          });
        }
        if (!mounted.current) {
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
          return;
        }
        recorder.record();
        if (mounted.current) { setStarted(true); callbacks.current.onRecordingChange(true); }
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      } catch (error) {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
        showDialog(t("microphoneRequired"), userFacingError(error, t));
        callbacks.current.onCancel();
      }
    })();
    return () => {
      mounted.current = false;
      if (recorder.isRecording) void recorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    };
  }, [microphoneMode, recorder]);

  const finish = useCallback(async (cancelled: boolean) => {
    if (finishing.current) return;
    finishing.current = true;
    const recordedDuration = duration.current;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      callbacks.current.onRecordingChange(false);
      if (cancelled) {
        callbacks.current.onCancel();
        return;
      }
      if (recordedDuration < 450) {
        callbacks.current.onTooShort();
        callbacks.current.onCancel();
        return;
      }
      if (!recorder.uri) throw new Error(t("tryAgain"));
      await callbacks.current.onComplete({ uri: recorder.uri, filename: `voice-${Date.now()}.m4a`, mimeType: "audio/mp4", kind: "audio", quality, purpose: "voice" });
    } catch (error) {
      showDialog(t("uploadFailed"), userFacingError(error, t));
      callbacks.current.onCancel();
    }
  }, [quality, recorder, showDialog, t]);

  useEffect(() => {
    if (!started) return;
    if (command === "cancel") void finish(true);
    else if (command === "finish") void finish(false);
  }, [command, finish, started]);

  return null;
}

function VoiceGestureButton({ command, disabled, onStart, onLock, onCancel, onFinish }: { command: VoiceRecordCommand; disabled: boolean; onStart: () => void; onLock: () => void; onCancel: () => void; onFinish: () => void }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const callbacks = useRef({ onStart, onLock, onCancel, onFinish });
  const state = useRef({ command, disabled });
  const resolved = useRef<"lock" | "cancel" | null>(null);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  callbacks.current = { onStart, onLock, onCancel, onFinish };
  state.current = { command, disabled };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !state.current.disabled && state.current.command === "idle",
    onMoveShouldSetPanResponder: () => !state.current.disabled && state.current.command === "idle",
    onPanResponderGrant: () => {
      resolved.current = null;
      translateX.value = 0;
      translateY.value = 0;
      scale.value = withTiming(1.12, { duration: reducedMotion ? 0 : 90 });
      callbacks.current.onStart();
    },
    onPanResponderMove: (_event, gesture) => {
      if (resolved.current) return;
      translateX.value = Math.max(-54, Math.min(0, gesture.dx * 0.38));
      translateY.value = Math.max(-42, Math.min(0, gesture.dy * 0.32));
      const decision = voiceGestureDecision(gesture.dx, gesture.dy);
      if (decision === "cancel") {
        resolved.current = "cancel";
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
        callbacks.current.onCancel();
      } else if (decision === "lock") {
        resolved.current = "lock";
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
        callbacks.current.onLock();
      }
    },
    onPanResponderRelease: () => {
      translateX.value = withTiming(0, { duration: reducedMotion ? 0 : 140 });
      translateY.value = withTiming(0, { duration: reducedMotion ? 0 : 140 });
      scale.value = withTiming(1, { duration: reducedMotion ? 0 : 120 });
      if (!resolved.current) callbacks.current.onFinish();
    },
    onPanResponderTerminate: () => {
      translateX.value = 0;
      translateY.value = 0;
      scale.value = 1;
      if (!resolved.current) callbacks.current.onCancel();
    },
  }), [reducedMotion, scale, translateX, translateY]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }] }));
  const locked = command === "locked";
  const active = command !== "idle";
  const activate = () => {
    if (locked || command === "holding") callbacks.current.onFinish();
    else if (command === "idle") {
      callbacks.current.onStart();
      callbacks.current.onLock();
    }
  };
  return (
    <Animated.View
      {...responder.panHandlers}
      accessible
      accessibilityActions={[{ name: "activate" }, { name: "escape" }]}
      accessibilityHint={locked ? t("recordingLocked") : t("releaseToSend")}
      accessibilityLabel={active ? t("stopRecording") : t("recordVoice")}
      accessibilityRole="button"
      onAccessibilityAction={(event) => event.nativeEvent.actionName === "escape" ? callbacks.current.onCancel() : activate()}
      style={[styles.send, { backgroundColor: active ? palette.danger : palette.accent, borderColor: palette.outline, opacity: disabled ? 0.45 : 1 }, animated]}
    >
      <Pressable disabled={disabled || !locked} onPress={onFinish} style={styles.voiceButtonFill}>
        <AppIcon name={locked ? "arrow-up" : "mic"} size={locked ? 21 : 20} color={active ? palette.onDanger : palette.onAccent} />
      </Pressable>
    </Animated.View>
  );
}

function RecordingStatus({ levels, durationMillis, locked }: { levels: number[]; durationMillis: number; locked: boolean }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const { t } = useTranslation();
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const pulse = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(pulse);
    pulse.value = reducedMotion ? 1 : withRepeat(withTiming(0.28, { duration: 520, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse, reducedMotion]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={[styles.recording, { backgroundColor: palette.surface }]}>
      <Animated.View style={[styles.recordDot, { backgroundColor: palette.danger }, pulseStyle]} />
      <Text style={[styles.recordingTime, { color: palette.text, fontSize: ui.font(13) }]}>{formatRecordingDuration(durationMillis)}</Text>
      <View style={styles.liveWaveform} accessible accessibilityLabel={t("liveMicrophoneLevel")}>
        {levels.map((level, index) => <View key={index} style={[styles.liveWaveformBar, { backgroundColor: palette.accent, height: 3 + level * 21 }]} />)}
      </View>
      <Text numberOfLines={2} style={[styles.recordingHint, { color: locked ? palette.accent : palette.secondaryText, fontSize: ui.font(10.5) }]}>{locked ? t("recordingLocked") : `${t("slideToCancel")} \u00b7 ${t("slideToLock")}`}</Text>
    </View>
  );
}

function MentionSuggestions({ participants, onSelect }: { participants: readonly UserSummary[]; onSelect: (username: string) => void }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const { t } = useTranslation();
  return (
    <View accessibilityLabel={t("people")} style={[styles.mentionList, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
      {participants.slice(0, 5).map((participant) => <Pressable key={participant.id} accessibilityRole="button" accessibilityLabel={`${participant.displayName}, @${participant.username}`} onPress={() => onSelect(participant.username)} style={({ pressed }) => [styles.mentionRow, { minHeight: ui.dense(46, 40), backgroundColor: pressed ? palette.surface : "transparent" }]}>
        <Avatar uri={participant.avatarUrl} label={participant.displayName} color={participant.avatarColor} online={participant.presence === "online"} size={32} />
        <View style={styles.mentionCopy}><Text numberOfLines={1} style={[styles.mentionName, { color: palette.text, fontSize: ui.font(14) }]}>{participant.displayName}</Text><Text numberOfLines={1} style={[styles.mentionUsername, { color: palette.secondaryText, fontSize: ui.font(12) }]}>@{participant.username}</Text></View>
      </Pressable>)}
    </View>
  );
}

function UnreadDivider() {
  const palette = usePalette();
  const { t } = useTranslation();
  return <View accessibilityRole="text" style={styles.unreadDivider}><View style={[styles.unreadLine, { backgroundColor: palette.accent }]} /><Text style={[styles.unreadText, { color: palette.accent }]}>{t("unreadMessages")}</Text><View style={[styles.unreadLine, { backgroundColor: palette.accent }]} /></View>;
}

function formatRecordingDuration(durationMillis: number): string {
  const seconds = Math.max(0, Math.floor(durationMillis / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function SelectionAction({ icon, label, danger = false, onPress }: { icon: AppIconName; label: string; danger?: boolean; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.selectionAction, { opacity: pressed ? 0.55 : 1 }]}>
      <AppIcon name={icon} size={23} color={danger ? palette.danger : palette.accent} />
      <Text numberOfLines={1} style={[styles.selectionLabel, { color: danger ? palette.danger : palette.secondaryText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, messageViewport: { flex: 1, overflow: "hidden" }, messageList: { flex: 1 }, list: { paddingVertical: 8 },
  firstFrameMessages: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end", overflow: "hidden", paddingVertical: 8 },
  headerIdentity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 18 },
  headerCopy: { minWidth: 0, maxWidth: 150 }, headerTitle: { fontSize: 15, lineHeight: 18, fontWeight: "800" }, headerSubtitle: { fontSize: 11, lineHeight: 14, marginTop: 1 },
  pinBanner: { minHeight: 46, borderBottomWidth: 1.25, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  pinAccent: { width: 3, height: 29, borderRadius: 2 }, pinCopy: { flex: 1, minWidth: 0 }, pinLabel: { fontSize: 12, fontWeight: "800" }, pinText: { fontSize: 12, marginTop: 1 },
  day: { width: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, marginVertical: 10 }, dayLine: { flex: 1, height: StyleSheet.hairlineWidth }, dayText: { fontSize: 11, fontWeight: "700" },
  unreadDivider: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 12, marginVertical: 5 }, unreadLine: { flex: 1, height: StyleSheet.hairlineWidth }, unreadText: { fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  empty: { alignItems: "center", paddingTop: 90, paddingHorizontal: 24 }, emptyTitle: { fontSize: 20, fontWeight: "800" }, emptyText: { fontSize: 14, marginTop: 6 },
  recording: { minHeight: 42, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 }, recordDot: { width: 9, height: 9, borderRadius: 5 }, recordingTime: { width: 38, fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "700" }, recordingHint: { maxWidth: 145, lineHeight: 13, fontWeight: "700" }, liveWaveform: { flex: 1, minWidth: 48, height: 28, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2, overflow: "hidden" }, liveWaveformBar: { width: 2, minHeight: 3, borderRadius: 2 },
  mentionList: { maxHeight: 230, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 3 }, mentionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 }, mentionCopy: { flex: 1, minWidth: 0 }, mentionName: { fontWeight: "700" }, mentionUsername: { marginTop: 1 },
  replyComposer: { minHeight: 50, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 9 },
  replyAccent: { width: 3, alignSelf: "stretch", marginVertical: 8, borderRadius: 2 },
  replyCopy: { flex: 1 }, replyName: { fontSize: 12, fontWeight: "800" }, replyText: { fontSize: 12, marginTop: 2 }, replyClose: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
  selectionToolbar: { minHeight: 58, flexDirection: "row", alignItems: "flex-start", borderTopWidth: 1.5, paddingTop: 7, paddingHorizontal: 4 },
  selectionAction: { flex: 1, minWidth: 0, minHeight: 47, alignItems: "center", justifyContent: "center", gap: 2 },
  selectionLabel: { maxWidth: "100%", paddingHorizontal: 2, fontSize: 10, fontWeight: "600" },
  composer: { minHeight: 58, flexDirection: "row", alignItems: "flex-end", borderTopWidth: 1.5, paddingTop: 7, paddingHorizontal: 7, gap: 6 }, composerButton: { width: 38, height: 42, alignItems: "center", justifyContent: "center" }, inputWrap: { flex: 1, minHeight: 41, maxHeight: 120, borderRadius: 19, borderWidth: 1.25, justifyContent: "center" }, input: { fontSize: 16, lineHeight: 20, paddingHorizontal: 13, paddingVertical: 9, maxHeight: 120 }, send: { width: 40, height: 40, borderRadius: 15, borderWidth: 1.25, alignItems: "center", justifyContent: "center", marginBottom: 1 }, voiceButtonFill: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", borderRadius: 14 },
});

function formatLastSeen(timestamp: number): string {
  if (!timestamp) return "—";
  const value = new Date(timestamp);
  const now = new Date();
  if (value.toDateString() === now.toDateString()) return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return value.toLocaleDateString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
