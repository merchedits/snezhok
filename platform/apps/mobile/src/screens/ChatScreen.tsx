import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CooperativeActivityType, Message } from "@snezhok/contracts";

import { useAppDialog } from "../components/AppDialogProvider";
import { ForwardPickerModal } from "../components/ForwardPickerModal";
import { PlayfulBackdrop } from "../components/PlayfulBackdrop";
import { MessageSearchModal } from "../components/MessageSearchModal";
import { ReactionPicker } from "../components/ReactionPicker";
import { ScheduledMessagesModal } from "../components/ScheduledMessagesModal";
import { ActivityLauncherSheet } from "../components/ActivityLauncherSheet";
import { CooperativeActivityModal } from "../components/CooperativeActivityModal";
import { ChatComposer } from "../components/chat/ChatComposer";
import { ChatHeader } from "../components/chat/ChatHeader";
import { ChatMessageList, type ChatMessageListHandle } from "../components/chat/ChatMessageList";
import { ChatPinnedBanner } from "../components/chat/ChatPinnedBanner";
import { ChatSelectionToolbar, type ChatSelectionAction } from "../components/chat/ChatSelectionToolbar";
import { VoicePlaybackBanner } from "../components/chat/ChatVoiceControls";
import { TogetherHistoryModal } from "../components/TogetherHistoryModal";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { userFacingError } from "../lib/userFacingError";
import { visibleMessages } from "../domains/messaging/messageReconciliation";
import { useAppStore } from "../store/useAppStore";
import { useChatSelection } from "../components/chat/useChatSelection";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

const emptyMessages: Message[] = [];
export function ChatScreen({ navigation, route }: Props) {
  const { streamId, streamKind, title } = route.params;
  const palette = usePalette();
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const insets = useSafeAreaInsets();
  const timeline = useRef<ChatMessageListHandle>(null);
  const messages = useAppStore((state) => state.messages[streamId] ?? emptyMessages);
  const me = useAppStore((state) => state.me);
  const conversation = useAppStore((state) => state.conversations.find((item) => item.id === streamId));
  const channel = useAppStore((state) => state.channels.find((item) => item.id === streamId));
  const peer = conversation?.saved ? undefined : (conversation?.participants.find((participant) => participant.id !== me?.id) ?? conversation?.participants[0]);
  const isGroup = conversation?.kind === "group";
  const runtimeCapabilities = useAppStore((state) => state.capabilities);
  const toggleReaction = useAppStore((state) => state.toggleReaction);
  const createActivity = useAppStore((state) => state.createActivity);
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  // Zustand selectors must return a stable snapshot. Filtering inside the
  // selector creates a new array on every read and React 19 treats that as an
  // endless external-store update, which crashed chats containing messages.
  const allScheduledMessages = useAppStore((state) => state.scheduledMessages);
  const scheduledMessages = useMemo(() => allScheduledMessages.filter((item) => item.streamId === streamId), [allScheduledMessages, streamId]);
  const cancelScheduledMessage = useAppStore((state) => state.cancelScheduledMessage);
  const [reactionTarget, setReactionTarget] = useState<{
    message: Message;
    anchorY: number;
  } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [scheduledVisible, setScheduledVisible] = useState(false);
  const [cancellingScheduledId, setCancellingScheduledId] = useState<string | null>(null);
  const [activityLauncher, setActivityLauncher] = useState(false);
  const [togetherHistory, setTogetherHistory] = useState(false);
  const [creatingActivity, setCreatingActivity] = useState(false);
  const [activeActivityMessage, setActiveActivityMessage] = useState<Message | null>(null);
  useEffect(() => {
    setReactionTarget(null);
    setReplyingTo(null);
    setEditingMessage(null);
  }, [streamId]);
  // Store reconciliation already maintains chronological order. Avoid copying,
  // sorting and reversing the entire history during the first navigation frame.
  const displayMessages = useMemo(() => visibleMessages(messages), [messages]);
  const beginEditing = useCallback((message: Message) => setEditingMessage(message), []);
  const selection = useChatSelection({
    streamId,
    streamKind,
    isGroup,
    messages: displayMessages,
    ...(me?.id ? { meId: me.id } : {}),
    reducedMotion,
    onEdit: beginEditing,
  });
  const { selectedIds, selectionMode, selectionProgress, toggle: toggleSelection } = selection;
  useEffect(() => {
    if (!selectionMode) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      selection.clear();
      return true;
    });
    return () => subscription.remove();
  }, [selection.clear, selectionMode]);
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
  const jumpToPinned = useCallback(() => {
    if (latestPin) void timeline.current?.jumpToMessage(latestPin.id);
  }, [latestPin]);

  const startActivity = useCallback(
    async (type: CooperativeActivityType, options: Record<string, unknown> = {}) => {
      if (creatingActivity) return;
      setCreatingActivity(true);
      try {
        const message = await createActivity(streamId, type, options);
        setActivityLauncher(false);
        setActiveActivityMessage(message);
        requestAnimationFrame(() => timeline.current?.scrollToEnd());
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      } catch (error) {
        showDialog(t("requestFailed"), userFacingError(error, t));
      } finally {
        setCreatingActivity(false);
      }
    },
    [createActivity, creatingActivity, showDialog, streamId, t],
  );

  const activeReactionEmojis = useMemo(() => new Set(reactionTarget?.message.reactions.filter((reaction) => reaction.reacted).map((reaction) => reaction.emoji) ?? []), [reactionTarget]);

  const selectReaction = useCallback(
    (emoji: string) => {
      const target = reactionTarget;
      setReactionTarget(null);
      if (!target) return;
      void Haptics.selectionAsync().catch(() => undefined);
      void toggleReaction(target.message, emoji).catch(() => showDialog(t("requestFailed"), t("tryAgain")));
    },
    [reactionTarget, t, toggleReaction],
  );

  const selectionActions: ChatSelectionAction[] = [
    ...(selection.hasClipboardText ? [{ icon: "copy-outline" as const, label: t("copy"), onPress: () => void selection.copy() }] : []),
    ...(selection.editableMessage ? [{ icon: "create-outline" as const, label: t("editMessage"), onPress: selection.edit }] : []),
    { icon: "return-up-forward-outline", label: t("forward"), onPress: selection.openForwardPicker },
    {
      icon: selection.allPinned ? "pin-outline" : "pin",
      label: t(selection.allPinned ? "unpinAction" : "pinAction"),
      onPress: () => void selection.togglePins(),
    },
    { icon: "trash-outline", label: t("deleteAction"), danger: true, onPress: selection.confirmDelete },
  ];

  return (
    <View testID="messaging_e2e_v1" style={[styles.screen, { backgroundColor: palette.chatCanvas }]}>
      <PlayfulBackdrop variant="chat" />
      <ChatHeader
        title={title}
        {...(route.params.subtitle ? { subtitle: route.params.subtitle } : {})}
        {...(peer ? { peer } : {})}
        selectedCount={selection.selectedCount}
        activitiesAvailable={runtimeCapabilities.activities && conversation?.kind === "direct" && !conversation.saved}
        scheduledCount={scheduledMessages.length}
        callsAvailable={runtimeCapabilities.calls && streamKind === "conversation"}
        onBack={navigation.goBack}
        onCancelSelection={selection.clear}
        onOpenProfile={(userId) => navigation.navigate("Profile", { userId })}
        onOpenActivities={() => setActivityLauncher(true)}
        onOpenScheduled={() => setScheduledVisible(true)}
        onStartCall={() => navigation.navigate("Call", { streamId, title })}
        onSearch={() => setSearchVisible(true)}
      />
      <ChatPinnedBanner message={latestPin} onPress={jumpToPinned} />
      <VoicePlaybackBanner streamId={streamId} />
      <KeyboardAvoidingView style={styles.keyboardRegion} behavior="translate-with-padding" automaticOffset keyboardVerticalOffset={0}>
        <ChatMessageList
          ref={timeline}
          navigation={navigation}
          streamId={streamId}
          streamKind={streamKind}
          title={title}
          {...(route.params.openedAt !== undefined ? { openedAt: route.params.openedAt } : {})}
          {...(route.params.targetMessageId ? { targetMessageId: route.params.targetMessageId } : {})}
          messages={messages}
          {...(conversation ? { conversation } : {})}
          channelUnreadCount={channel?.unreadCount ?? 0}
          {...(me?.id ? { meId: me.id } : {})}
          isGroup={isGroup}
          selectedIds={selectedIds}
          selectionMode={selectionMode}
          selectionProgress={selectionProgress}
          onToggleSelection={toggleSelection}
          onReply={setReplyingTo}
          onOpenReactions={(message, anchorY) => setReactionTarget({ message, anchorY })}
          onOpenActivity={setActiveActivityMessage}
        />
        {selection.selectionMode ? (
          <ChatSelectionToolbar actions={selectionActions} bottomInset={insets.bottom} />
        ) : (
          <ChatComposer
            streamId={streamId}
            streamKind={streamKind}
            isGroup={isGroup}
            participants={typingParticipants}
            {...(me?.id ? { meId: me.id } : {})}
            replyingTo={replyingTo}
            editingMessage={editingMessage}
            onCancelReply={() => setReplyingTo(null)}
            onCancelEditing={() => setEditingMessage(null)}
            onEditingComplete={() => setEditingMessage(null)}
          />
        )}
      </KeyboardAvoidingView>
      <ReactionPicker visible={Boolean(reactionTarget)} anchorY={reactionTarget?.anchorY ?? 0} activeEmojis={activeReactionEmojis} onClose={() => setReactionTarget(null)} onSelect={selectReaction} />
      <ForwardPickerModal visible={selection.forwardPickerVisible} busy={selection.forwarding} onClose={selection.closeForwardPicker} onSelect={selection.selectForwardTarget} />
      <MessageSearchModal
        visible={searchVisible}
        streamId={streamId}
        onClose={() => setSearchVisible(false)}
        onOpenUser={(user) => {
          setSearchVisible(false);
          navigation.navigate("Profile", { userId: user.id });
        }}
        onOpenMessage={(message) => {
          setSearchVisible(false);
          void timeline.current?.jumpToMessage(message.id);
        }}
      />
      <ScheduledMessagesModal
        visible={scheduledVisible}
        messages={scheduledMessages}
        cancellingId={cancellingScheduledId}
        onClose={() => setScheduledVisible(false)}
        onCancel={(message) => {
          showDialog(t("cancelScheduledMessage"), message.text, [
            { text: t("cancel"), style: "cancel" },
            {
              text: t("deleteMessage"),
              style: "destructive",
              onPress: () => {
                setCancellingScheduledId(message.id);
                void cancelScheduledMessage(message.id)
                  .catch(() => showDialog(t("requestFailed"), t("tryAgain")))
                  .finally(() => setCancellingScheduledId(null));
              },
            },
          ]);
        }}
      />
      <ActivityLauncherSheet
        visible={activityLauncher}
        busy={creatingActivity}
        onClose={() => {
          if (!creatingActivity) setActivityLauncher(false);
        }}
        onOpenHistory={() => {
          setActivityLauncher(false);
          requestAnimationFrame(() => setTogetherHistory(true));
        }}
        onStart={(type, options) => void startActivity(type, options)}
      />
      <TogetherHistoryModal
        visible={togetherHistory}
        conversationId={streamId}
        onClose={() => setTogetherHistory(false)}
        onOpen={(activityMessage) => {
          setTogetherHistory(false);
          requestAnimationFrame(() => setActiveActivityMessage(activityMessage));
        }}
      />
      <CooperativeActivityModal message={activeActivityMessage ? (messages.find((message) => message.id === activeActivityMessage.id) ?? activeActivityMessage) : null} onClose={() => setActiveActivityMessage(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  keyboardRegion: { flex: 1 },
});
