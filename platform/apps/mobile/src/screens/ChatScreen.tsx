import { AppIcon, type AppIconName } from "../components/AppIcon";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppSettings, Attachment, Message, UploadQuality } from "@snezhok/contracts";

import { AttachmentSheet } from "../components/AttachmentSheet";
import { useAppDialog } from "../components/AppDialogProvider";
import { Avatar } from "../components/Avatar";
import { ForwardPickerModal } from "../components/ForwardPickerModal";
import { MessageBubble } from "../components/MessageBubble";
import { MessageSearchModal } from "../components/MessageSearchModal";
import { ReactionPicker } from "../components/ReactionPicker";
import { ScreenHeader } from "../components/ScreenHeader";
import { ScheduledMessagesModal } from "../components/ScheduledMessagesModal";
import { SwipeReplyRow } from "../components/SwipeReplyRow";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { composerBottomPadding } from "../lib/keyboardLayout";
import { chunkMediaMessages } from "../lib/mediaAlbums";
import { selectedMessageText } from "../lib/messageSelection";
import { isUploadCancelled } from "../lib/uploadPolicy";
import { userFacingError } from "../lib/userFacingError";
import { dismissMessageNotifications } from "../notifications/androidNotifications";
import { appendRecordingLevel, recordingSourceForMicrophone, routeThroughEarpieceForMicrophone } from "../lib/recordingWaveform";
import { visibleMessages } from "../store/messageReconciliation";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList, UploadInput } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

const maintainVisibleMessagePosition = { startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 } as const;
const emptyMessages: Message[] = [];
const messageKey = (message: Message) => message.id;
const messageCellType = (message: Message) => {
  if (message.kind === "voice" || message.attachments.some((attachment) => attachment.kind === "audio")) return "voice";
  if (message.attachments.some((attachment) => attachment.kind === "image" || attachment.kind === "video")) return "media";
  return message.kind;
};

export function ChatScreen({ navigation, route }: Props) {
  const { streamId, streamKind, title } = route.params;
  const palette = usePalette();
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const list = useRef<FlashListRef<Message>>(null);
  const messages = useAppStore((state) => state.messages[streamId] ?? emptyMessages);
  const me = useAppStore((state) => state.me);
  const conversationParticipants = useAppStore((state) => state.conversations.find((item) => item.id === streamId)?.participants);
  const conversationSaved = useAppStore((state) => state.conversations.find((item) => item.id === streamId)?.saved ?? false);
  const isGroup = useAppStore((state) => state.conversations.find((item) => item.id === streamId)?.kind === "group");
  const peer = conversationSaved ? undefined : conversationParticipants?.find((participant) => participant.id !== me?.id) ?? conversationParticipants?.[0];
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
  const uploadAttachment = useAppStore((state) => state.uploadAttachment);
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
  const [attachmentSheet, setAttachmentSheet] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadBatch, setUploadBatch] = useState<{ completed: number; total: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [forwardPicker, setForwardPicker] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [reactionTarget, setReactionTarget] = useState<{ message: Message; anchorY: number } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [scheduledVisible, setScheduledVisible] = useState(false);
  const [cancellingScheduledId, setCancellingScheduledId] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  const selectionProgress = useSharedValue(0);
  const selectionMode = selectedIds.size > 0;
  const initialPositioned = useRef(false);
  const draftBeforeEdit = useRef("");

  useEffect(() => {
    selectionProgress.value = withTiming(selectionMode ? 1 : 0, {
      duration: reducedMotion ? 0 : 160,
      easing: Easing.out(Easing.cubic),
    });
  }, [reducedMotion, selectionMode, selectionProgress]);

  useEffect(() => {
    void Promise.all([loadMessages(streamId), loadPinnedMessages(streamId)]).catch(() => undefined);
  }, [loadMessages, loadPinnedMessages, streamId]);
  useEffect(() => {
    setSelectedIds(new Set());
    setForwardPicker(false);
    setReactionTarget(null);
    setReplyingTo(null);
    setEditingMessage(null);
    setText(useAppStore.getState().drafts[streamId] ?? "");
    initialPositioned.current = false;
  }, [streamId]);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);

  // Store reconciliation already maintains chronological order. Avoid copying,
  // sorting and reversing the entire history during the first navigation frame.
  const displayMessages = useMemo(() => visibleMessages(messages), [messages]);
  const sorted = displayMessages;
  const selectedMessages = useMemo(() => sorted.filter((message) => selectedIds.has(message.id)), [selectedIds, sorted]);
  const clipboardText = useMemo(() => selectedMessageText(selectedMessages), [selectedMessages]);
  const latestSequence = useMemo(() => messages.reduce((maximum, message) => Math.max(maximum, message.sequence), 0), [messages]);
  const latestPin = useMemo(() => [...messages].filter((message) => message.pinnedAt && !message.deletedAt).sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))[0], [messages]);

  useEffect(() => {
    if (!isFocused || latestSequence <= 0) return;
    void markStreamRead(streamId, latestSequence).catch(() => undefined);
  }, [isFocused, latestSequence, markStreamRead, streamId]);
  useEffect(() => {
    if (isFocused) void dismissMessageNotifications(streamId).catch(() => undefined);
  }, [isFocused, streamId]);

  const jumpToMessage = useCallback(async (messageId: string) => {
    await loadMessageContext(streamId, messageId).catch(() => undefined);
    requestAnimationFrame(() => {
      const current = visibleMessages(useAppStore.getState().messages[streamId] ?? []);
      const index = current.findIndex((message) => message.id === messageId);
      if (index >= 0) list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.25 });
    });
  }, [loadMessageContext, streamId]);

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

  const handleTextChange = (value: string) => {
    setText(value);
    if (!editingMessage) setDraft(streamId, value);
  };

  const sendText = async (silent = false) => {
    const value = text.trim();
    if (!value) return;
    if (editingMessage) {
      const restoringDraft = draftBeforeEdit.current;
      setText(restoringDraft);
      setEditingMessage(null);
      await editMessage(editingMessage, value);
      return;
    }
    setText("");
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
    setDraft(streamId, "");
    const replyToId = replyingTo?.id ?? null;
    setReplyingTo(null);
    await scheduleTextMessage(streamId, { text: value, kind: "text", replyToId, attachmentIds: [], silent: false }, Date.now() + delayMs);
  };

  const handleUploads = useCallback(async (inputs: UploadInput[], messageKind: "media" | "file" | "video-note" | "voice" = "media") => {
    if (!inputs.length) return;
    if (!online) return showDialog(t("offline"), t("attachmentOnline"));
    setUploading(true);
    setUploadBatch({ completed: 0, total: inputs.length });
    try {
      const attachments: Attachment[] = [];
      for (let index = 0; index < inputs.length; index += 1) {
        setUploadBatch({ completed: index, total: inputs.length });
        attachments.push(await uploadAttachment(inputs[index]!));
      }
      const replyToId = replyingTo?.id ?? null;
      setReplyingTo(null);
      const groups = messageKind === "media" ? chunkMediaMessages(attachments) : [attachments];
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index]!;
        await sendMessage(streamId, {
          text: "",
          kind: messageKind,
          replyToId: index === 0 ? replyToId : null,
          attachmentIds: group.map((attachment) => attachment.id),
        }, group);
      }
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
      setUploadBatch(null);
    }
  }, [online, replyingTo?.id, sendMessage, streamId, t, uploadAttachment]);

  const handleUpload = useCallback(async (input: UploadInput, messageKind: "media" | "file" | "video-note" | "voice" = "media") => {
    await handleUploads([input], messageKind);
  }, [handleUploads]);

  const beginRecording = async () => {
    if (!online) return showDialog(t("offline"), t("voiceOnline"));
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return showDialog(t("microphoneRequired"), t("allowMicrophone"));
    setRecorderMounted(true);
  };

  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const previous = displayMessages[index - 1];
    const showDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(item.createdAt).toDateString();
    const groupedWithPrevious = !showDay && previous?.sender.id === item.sender.id && item.createdAt - previous.createdAt <= 5 * 60_000;
    const showSender = (streamKind === "channel" || isGroup) && !groupedWithPrevious;
    return <View>{showDay ? <View style={styles.day}><View style={[styles.dayLine, { backgroundColor: palette.border }]} /><Text style={[styles.dayText, { color: palette.secondaryText }]}>{new Date(item.createdAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</Text><View style={[styles.dayLine, { backgroundColor: palette.border }]} /></View> : null}<SwipeReplyRow disabled={selectionMode || Boolean(item.pending || item.failed)} onReply={() => { setReplyingTo(item); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); }}><MessageBubble message={item} mine={item.sender.id === me?.id} showSender={showSender} variant={streamKind === "channel" ? "channel" : "bubble"} selected={selectedIds.has(item.id)} selectionMode={selectionMode} selectionProgress={selectionProgress} onPress={() => toggleSelected(item)} onLongPress={() => { if (!selectedIds.has(item.id)) toggleSelected(item); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); }} onOpenReactions={(anchorY) => setReactionTarget({ message: item, anchorY })} onReplyPress={(messageId) => void jumpToMessage(messageId)} onReact={(emoji) => void toggleReaction(item, emoji).catch(() => showDialog(t("requestFailed"), t("tryAgain")))} /></SwipeReplyRow></View>;
  }, [displayMessages, isGroup, jumpToMessage, me?.id, palette.border, palette.secondaryText, selectedIds, selectionMode, selectionProgress, streamKind, t, toggleReaction, toggleSelected]);

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
    showDialog(
      t("deleteMessagesTitle", { count: selectedMessages.length }),
      t("deleteMessagesAudience"),
      [
        { text: t("cancel"), style: "cancel" },
        { text: t("deleteForMe"), onPress: () => void remove("me") },
        { text: t("deleteForEveryone"), style: "destructive", onPress: () => void remove("everyone") },
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
    setSelectedIds(new Set());
  };

  const cancelEditing = () => {
    setEditingMessage(null);
    setText(draftBeforeEdit.current);
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
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.background }]} behavior="height" automaticOffset keyboardVerticalOffset={0}>
      {selectedIds.size > 0
        ? <ScreenHeader title={String(selectedIds.size)} left={{ icon: "close", label: t("cancel"), onPress: () => setSelectedIds(new Set()) }} />
        : <ScreenHeader title={title} {...(route.params.subtitle ? { subtitle: route.params.subtitle } : {})} left={{ icon: "chevron-back", label: t("back"), onPress: navigation.goBack }} center={peer ? <Pressable onPress={() => navigation.navigate("Profile", { userId: peer.id })} style={styles.headerIdentity} accessibilityRole="button"><Avatar uri={peer.avatarUrl} label={peer.displayName} color={peer.avatarColor} online={peer.presence === "online"} size={34} /><View style={styles.headerCopy}><Text numberOfLines={1} style={[styles.headerTitle, { color: palette.text }]}>{peer.displayName}</Text><Text numberOfLines={1} style={[styles.headerSubtitle, { color: peer.presence === "online" ? palette.success : palette.secondaryText }]}>{peer.presence === "online" ? t("online") : t("lastSeen", { date: formatLastSeen(peer.lastSeenAt) })}</Text></View></Pressable> : undefined} right={[...(scheduledMessages.length ? [{ icon: "time-outline" as const, label: t("scheduledMessages"), onPress: () => setScheduledVisible(true) }] : []), { icon: "search", label: t("search"), onPress: () => setSearchVisible(true) }, ...(streamKind === "conversation" ? [{ icon: "call-outline" as const, label: t("startCall"), onPress: () => navigation.navigate("Call", { streamId, title }) }] : [])]} />}
      {latestPin ? <Pressable onPress={jumpToPinned} style={({ pressed }) => [styles.pinBanner, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : palette.background }]}><View style={[styles.pinAccent, { backgroundColor: palette.accent }]} /><AppIcon name="pin" size={17} color={palette.accent} /><View style={styles.pinCopy}><Text style={[styles.pinLabel, { color: palette.accent }]}>{t("pinnedMessage")}</Text><Text numberOfLines={1} style={[styles.pinText, { color: palette.secondaryText }]}>{latestPin.text || t("attachment")}</Text></View></Pressable> : null}
      <FlashList ref={list} data={displayMessages} keyExtractor={messageKey} getItemType={messageCellType} renderItem={renderMessage} style={styles.messageList} contentContainerStyle={styles.list} drawDistance={360} keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} keyboardShouldPersistTaps="handled" maintainVisibleContentPosition={maintainVisibleMessagePosition} onStartReached={() => void loadOlderMessages(streamId).catch(() => undefined)} onStartReachedThreshold={0.35} onContentSizeChange={() => { if (!initialPositioned.current && displayMessages.length) { initialPositioned.current = true; requestAnimationFrame(() => list.current?.scrollToEnd({ animated: false })); } }} ListEmptyComponent={emptyState} />
      {selectedIds.size > 0 ? <View style={[styles.selectionToolbar, { paddingBottom: Math.max(insets.bottom, 8), borderColor: palette.border, backgroundColor: palette.background }]}>
        {clipboardText ? <SelectionAction icon="copy-outline" label={t("copy")} onPress={() => void copySelected()} /> : null}
        {editableMessage ? <SelectionAction icon="create-outline" label={t("editMessage")} onPress={beginEditing} /> : null}
        <SelectionAction icon="return-up-forward-outline" label={t("forward")} onPress={() => setForwardPicker(true)} />
        <SelectionAction icon={selectedMessages.every((message) => Boolean(message.pinnedAt)) ? "pin-outline" : "pin"} label={t(selectedMessages.every((message) => Boolean(message.pinnedAt)) ? "unpinMessage" : "pinMessage")} onPress={() => void toggleSelectedPins()} />
        <SelectionAction danger icon="trash-outline" label={t("deleteMessage")} onPress={confirmDeleteSelected} />
      </View> : <>
        {recording ? <RecordingStatus levels={recordingLevels} durationMillis={recordingDuration} /> : null}
        {editingMessage ? <View style={[styles.replyComposer, { backgroundColor: palette.surface, borderColor: palette.border }]}><View style={[styles.replyAccent, { backgroundColor: palette.accent }]} /><View style={styles.replyCopy}><Text style={[styles.replyName, { color: palette.accent }]}>{t("editMessage")}</Text><Text numberOfLines={1} style={[styles.replyText, { color: palette.secondaryText }]}>{editingMessage.text}</Text></View><Pressable onPress={cancelEditing} style={styles.replyClose}><AppIcon name="close" size={21} color={palette.secondaryText} /></Pressable></View> : replyingTo ? <View style={[styles.replyComposer, { backgroundColor: palette.surface, borderColor: palette.border }]}><View style={[styles.replyAccent, { backgroundColor: palette.accent }]} /><View style={styles.replyCopy}><Text numberOfLines={1} style={[styles.replyName, { color: palette.accent }]}>{replyingTo.sender.displayName}</Text><Text numberOfLines={1} style={[styles.replyText, { color: palette.secondaryText }]}>{replyingTo.text || t("attachment")}</Text></View><Pressable onPress={() => setReplyingTo(null)} style={styles.replyClose}><AppIcon name="close" size={21} color={palette.secondaryText} /></Pressable></View> : null}
        <View style={[styles.composer, { borderColor: palette.border, backgroundColor: palette.background, paddingBottom: composerBottomPadding(insets.bottom, keyboardVisible) }]}>
          <Pressable disabled={uploading || recording} onPress={() => setAttachmentSheet(true)} style={styles.composerButton} accessibilityLabel={t("attachFile")}><AppIcon name="add-circle-outline" size={27} color={uploading || recording ? palette.faintText : palette.accent} /></Pressable>
          <View style={[styles.inputWrap, { backgroundColor: palette.surface }]}><TextInput value={text} onChangeText={handleTextChange} onFocus={() => setKeyboardVisible(true)} editable={!recording} multiline maxLength={16_000} placeholder={recording ? t("recording") : t("message")} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text }]} /></View>
          {uploading ? <View style={styles.composerButton}><ActivityIndicator color={palette.accent} /></View> : text.trim() ? <Pressable delayLongPress={320} onPress={() => void sendText()} onLongPress={showSendOptions} style={[styles.send, { backgroundColor: palette.accent }]} accessibilityLabel={t("sendMessage")}><AppIcon name="arrow-up" size={21} color="white" strokeWidth={2} /></Pressable> : recorderMounted ? <VoiceRecorderControl quality={uploadQuality} microphoneMode={microphoneMode} onRecordingChange={setRecording} onMetering={(metering, durationMillis) => { setRecordingLevels((levels) => appendRecordingLevel(levels, metering)); setRecordingDuration(durationMillis); }} onCancel={() => { setRecording(false); setRecordingLevels([]); setRecordingDuration(0); setRecorderMounted(false); }} onComplete={async (input) => { setRecording(false); setRecordingLevels([]); setRecordingDuration(0); setRecorderMounted(false); await handleUpload(input, "voice"); }} /> : <Pressable onPress={() => { setRecordingLevels([]); setRecordingDuration(0); void beginRecording(); }} style={[styles.send, { backgroundColor: palette.accent }]} accessibilityLabel={t("recordVoice")}><AppIcon name="mic" size={20} color="white" /></Pressable>}
        </View>
      </>}
      <AttachmentSheet visible={attachmentSheet} busy={uploading} progress={uploadBatch && uploadProgress !== null ? Math.round(((uploadBatch.completed + uploadProgress / 100) / uploadBatch.total) * 100) : uploadProgress} onClose={closeAttachmentSheet} onCancel={() => void cancelUpload()} onSelect={handleUploads} />
      <ReactionPicker visible={Boolean(reactionTarget)} anchorY={reactionTarget?.anchorY ?? 0} activeEmojis={activeReactionEmojis} onClose={() => setReactionTarget(null)} onSelect={selectReaction} />
      <ForwardPickerModal
        visible={forwardPicker}
        busy={forwarding}
        onClose={closeForwardPicker}
        onSelect={selectForwardTarget}
      />
      <MessageSearchModal visible={searchVisible} streamId={streamId} onClose={() => setSearchVisible(false)} onOpenMessage={(message) => { setSearchVisible(false); void jumpToMessage(message.id); }} />
      <ScheduledMessagesModal visible={scheduledVisible} messages={scheduledMessages} cancellingId={cancellingScheduledId} onClose={() => setScheduledVisible(false)} onCancel={(message) => {
        showDialog(t("cancelScheduledMessage"), message.text, [
          { text: t("cancel"), style: "cancel" },
          { text: t("deleteMessage"), style: "destructive", onPress: () => {
            setCancellingScheduledId(message.id);
            void cancelScheduledMessage(message.id).catch(() => showDialog(t("requestFailed"), t("tryAgain"))).finally(() => setCancellingScheduledId(null));
          } },
        ]);
      }} />
    </KeyboardAvoidingView>
  );
}

function VoiceRecorderControl({ quality, microphoneMode, onRecordingChange, onMetering, onCancel, onComplete }: { quality: UploadQuality; microphoneMode: AppSettings["microphoneMode"]; onRecordingChange: (value: boolean) => void; onMetering: (metering: number | undefined, durationMillis: number) => void; onCancel: () => void; onComplete: (input: UploadInput) => Promise<void> }) {
  const palette = usePalette();
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
  const onMeteringRef = useRef(onMetering);
  onMeteringRef.current = onMetering;

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
        await recorder.prepareToRecordAsync();
        recorder.record();
        if (mounted.current) { setStarted(true); onRecordingChange(true); }
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      } catch (error) {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
        showDialog(t("microphoneRequired"), userFacingError(error, t));
        onCancel();
      }
    })();
    return () => {
      mounted.current = false;
      if (recorder.isRecording) void recorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    };
  }, [microphoneMode, recorder]);

  const finish = async () => {
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!recorder.uri) throw new Error(t("tryAgain"));
      await onComplete({ uri: recorder.uri, filename: `voice-${Date.now()}.m4a`, mimeType: "audio/mp4", kind: "audio", quality, purpose: "voice" });
    } catch (error) {
      showDialog(t("uploadFailed"), userFacingError(error, t));
      onCancel();
    }
  };

  if (!started) return <View style={styles.composerButton}><ActivityIndicator color={palette.accent} /></View>;
  return <Pressable onPress={() => void finish()} style={[styles.send, { backgroundColor: palette.danger }]} accessibilityLabel={t("stopRecording")}><AppIcon name="stop" size={20} color="white" /></Pressable>;
}

function RecordingStatus({ levels, durationMillis }: { levels: number[]; durationMillis: number }) {
  const palette = usePalette();
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
      <Text style={[styles.recordingTime, { color: palette.text }]}>{formatRecordingDuration(durationMillis)}</Text>
      <View style={styles.liveWaveform} accessibilityLabel="Live microphone level">
        {levels.map((level, index) => <View key={index} style={[styles.liveWaveformBar, { backgroundColor: palette.accent, height: 3 + level * 21 }]} />)}
      </View>
    </View>
  );
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
  screen: { flex: 1 }, messageList: { flex: 1 }, list: { paddingVertical: 8 },
  headerIdentity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 18 },
  headerCopy: { minWidth: 0, maxWidth: 150 }, headerTitle: { fontSize: 15, lineHeight: 18, fontWeight: "800" }, headerSubtitle: { fontSize: 11, lineHeight: 14, marginTop: 1 },
  pinBanner: { minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  pinAccent: { width: 3, height: 29, borderRadius: 2 }, pinCopy: { flex: 1, minWidth: 0 }, pinLabel: { fontSize: 12, fontWeight: "800" }, pinText: { fontSize: 12, marginTop: 1 },
  day: { width: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, marginVertical: 10 }, dayLine: { flex: 1, height: StyleSheet.hairlineWidth }, dayText: { fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", paddingTop: 90, paddingHorizontal: 24 }, emptyTitle: { fontSize: 20, fontWeight: "800" }, emptyText: { fontSize: 14, marginTop: 6 },
  recording: { minHeight: 42, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 9 }, recordDot: { width: 9, height: 9, borderRadius: 5 }, recordingTime: { width: 38, fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "700" }, liveWaveform: { flex: 1, height: 28, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2, overflow: "hidden" }, liveWaveformBar: { width: 2, minHeight: 3, borderRadius: 2 },
  replyComposer: { minHeight: 50, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 9 },
  replyAccent: { width: 3, alignSelf: "stretch", marginVertical: 8, borderRadius: 2 },
  replyCopy: { flex: 1 }, replyName: { fontSize: 12, fontWeight: "800" }, replyText: { fontSize: 12, marginTop: 2 }, replyClose: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
  selectionToolbar: { minHeight: 58, flexDirection: "row", alignItems: "flex-start", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 7, paddingHorizontal: 4 },
  selectionAction: { flex: 1, minWidth: 0, minHeight: 47, alignItems: "center", justifyContent: "center", gap: 2 },
  selectionLabel: { maxWidth: "100%", paddingHorizontal: 2, fontSize: 10, fontWeight: "600" },
  composer: { minHeight: 54, flexDirection: "row", alignItems: "flex-end", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, paddingHorizontal: 6, gap: 5 }, composerButton: { width: 38, height: 40, alignItems: "center", justifyContent: "center" }, inputWrap: { flex: 1, minHeight: 39, maxHeight: 120, borderRadius: 19, justifyContent: "center" }, input: { fontSize: 16, lineHeight: 20, paddingHorizontal: 13, paddingVertical: 9, maxHeight: 120 }, send: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginBottom: 1 },
});

function formatLastSeen(timestamp: number): string {
  if (!timestamp) return "—";
  const value = new Date(timestamp);
  const now = new Date();
  if (value.toDateString() === now.toDateString()) return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return value.toLocaleDateString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
