import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Easing, useSharedValue, withTiming } from "react-native-reanimated";

import type { Message } from "@snezhok/contracts";

import { useAppDialog } from "../AppDialogProvider";
import { useTranslation } from "../../i18n";
import { selectedMessageText } from "../../lib/messageSelection";
import { userFacingError } from "../../lib/userFacingError";
import { useAppStore } from "../../store/useAppStore";

interface Options {
  streamId: string;
  streamKind: "conversation" | "channel";
  isGroup: boolean;
  messages: readonly Message[];
  meId?: string;
  reducedMotion: boolean;
  onEdit: (message: Message) => void;
}

export function useChatSelection({ streamId, streamKind, isGroup, messages, meId, reducedMotion, onEdit }: Options) {
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const forwardMessage = useAppStore((state) => state.forwardMessage);
  const deleteMessages = useAppStore((state) => state.deleteMessages);
  const setMessagePinned = useAppStore((state) => state.setMessagePinned);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [forwardPickerVisible, setForwardPickerVisible] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const selectionProgress = useSharedValue(0);
  const selectedMessages = useMemo(() => messages.filter((message) => selectedIds.has(message.id)), [messages, selectedIds]);
  const clipboardText = useMemo(() => selectedMessageText(selectedMessages), [selectedMessages]);
  const editableMessage = selectedMessages.length === 1
    ? (selectedMessages[0]?.sender.id === meId && selectedMessages[0]?.kind === "text" && !selectedMessages[0]?.pending && !selectedMessages[0]?.failed ? selectedMessages[0] : null)
    : null;
  const allPinned = selectedMessages.length > 0 && selectedMessages.every((message) => Boolean(message.pinnedAt));

  useEffect(() => {
    selectionProgress.value = withTiming(selectedIds.size > 0 ? 1 : 0, {
      duration: reducedMotion ? 0 : 160,
      easing: Easing.out(Easing.cubic),
    });
  }, [reducedMotion, selectedIds.size, selectionProgress]);

  useEffect(() => {
    setSelectedIds(new Set());
    setForwardPickerVisible(false);
  }, [streamId]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);
  const toggle = useCallback((message: Message) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });
  }, []);

  const copy = useCallback(async () => {
    if (!clipboardText) return;
    clear();
    await Clipboard.setStringAsync(clipboardText);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, [clear, clipboardText]);

  const edit = useCallback(() => {
    if (!editableMessage) return;
    clear();
    onEdit(editableMessage);
  }, [clear, editableMessage, onEdit]);

  const togglePins = useCallback(async () => {
    const eligible = selectedMessages.filter((message) => !message.pending && !message.failed);
    if (!eligible.length) return;
    const pinned = !eligible.every((message) => Boolean(message.pinnedAt));
    clear();
    try {
      await Promise.all(eligible.map((message) => setMessagePinned(message, pinned)));
    } catch (error) {
      showDialog(t("requestFailed"), userFacingError(error, t));
    }
  }, [clear, selectedMessages, setMessagePinned, showDialog, t]);

  const confirmDelete = useCallback(() => {
    const snapshot = selectedMessages;
    const remove = async (scope: "me" | "everyone") => {
      clear();
      try {
        await deleteMessages(snapshot, scope);
      } catch (error) {
        showDialog(t("requestFailed"), userFacingError(error, t));
      }
    };
    const canDeleteForEveryone = snapshot.every((message) => message.sender.id === meId) || (streamKind === "conversation" && !isGroup);
    showDialog(t("deleteMessagesTitle", { count: snapshot.length }), t("deleteMessagesAudience"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("deleteForMe"), onPress: () => void remove("me") },
      ...(canDeleteForEveryone ? [{ text: t("deleteForEveryone"), style: "destructive" as const, onPress: () => void remove("everyone") }] : []),
    ]);
  }, [clear, deleteMessages, isGroup, meId, selectedMessages, showDialog, streamKind, t]);

  const selectForwardTarget = useCallback(async (target: { id: string }) => {
    const snapshot = selectedMessages;
    setForwardPickerVisible(false);
    clear();
    setForwarding(true);
    try {
      await Promise.all(snapshot.map((message) => forwardMessage(message.id, target.id)));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch {
      showDialog(t("requestFailed"), t("tryAgain"));
    } finally {
      setForwarding(false);
    }
  }, [clear, forwardMessage, selectedMessages, showDialog, t]);

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    selectionMode: selectedIds.size > 0,
    selectionProgress,
    hasClipboardText: Boolean(clipboardText),
    editableMessage,
    allPinned,
    toggle,
    clear,
    copy,
    edit,
    togglePins,
    confirmDelete,
    forwardPickerVisible,
    forwarding,
    openForwardPicker: () => setForwardPickerVisible(true),
    closeForwardPicker: () => { if (!forwarding) setForwardPickerVisible(false); },
    selectForwardTarget: (target: { id: string }) => { void selectForwardTarget(target); },
  };
}
