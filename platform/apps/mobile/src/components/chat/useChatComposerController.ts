import { requestRecordingPermissionsAsync } from "expo-audio";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Message, UserSummary } from "@snezhok/contracts";

import { useAppDialog } from "../AppDialogProvider";
import { useTranslation } from "../../i18n";
import { activeMentionQuery, insertMention, mentionSuggestions } from "../../lib/mentionAutocomplete";
import { applyTextFormat, type TextFormat } from "../../domains/messaging/textFormatting";
import { emitRealtimeTyping } from "../../lib/realtimeBridge";
import { appendRecordingLevel, appendRecordingWaveformSample, finalizeRecordingWaveform } from "../../lib/recordingWaveform";
import { stopVoicePlayback } from "../../lib/voicePlaybackCoordinator";
import { isUploadCancelled } from "../../lib/uploadPolicy";
import { userFacingError } from "../../lib/userFacingError";
import { useAppStore } from "../../store/useAppStore";
import type { UploadInput } from "../../types";
import { useTransferProgress } from "../../transfers/useTransferProgress";
import type { VoiceRecordCommand } from "./ChatVoiceControls";

export interface ChatComposerControllerInput {
  streamId: string;
  streamKind: "conversation" | "channel";
  isGroup: boolean;
  participants: readonly UserSummary[];
  meId: string | undefined;
  replyingTo: Message | null;
  editingMessage: Message | null;
  onCancelReply: () => void;
  onCancelEditing: () => void;
  onEditingComplete: () => void;
}

/**
 * Stateful command controller for the composer. The rendered component stays
 * declarative; draft durability, typing leases, upload retries, and recorder
 * transitions live behind this single vertical boundary.
 */
export function useChatComposerController(input: ChatComposerControllerInput) {
  const {
    streamId, streamKind, isGroup, participants, meId, replyingTo, editingMessage,
    onCancelReply, onCancelEditing, onEditingComplete,
  } = input;
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const online = useAppStore((state) => state.online);
  const capabilities = useAppStore((state) => state.capabilities);
  const uploadQuality = useAppStore((state) => state.settings.defaultUploadQuality);
  const microphoneMode = useAppStore((state) => state.settings.microphoneMode);
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const setDraft = useAppStore((state) => state.setDraft);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const editMessage = useAppStore((state) => state.editMessage);
  const scheduleTextMessage = useAppStore((state) => state.scheduleTextMessage);
  const sendAttachmentBatch = useAppStore((state) => state.sendAttachmentBatch);
  const cancelTransfer = useAppStore((state) => state.cancelUpload);
  const initialDraft = useAppStore.getState().drafts[streamId] ?? "";
  const [text, setText] = useState(initialDraft);
  const [selection, setSelection] = useState({ start: initialDraft.length, end: initialDraft.length });
  const [attachmentSheet, setAttachmentSheet] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTransferId, setActiveTransferId] = useState<string | null>(null);
  const uploadProgress = useTransferProgress(activeTransferId);
  const [recorderMounted, setRecorderMounted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingLevels, setRecordingLevels] = useState<number[]>([]);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [voiceCommand, setVoiceCommand] = useState<VoiceRecordCommand>("idle");
  const voiceCommandRef = useRef<VoiceRecordCommand>("idle");
  const recordingWaveformSamples = useRef<number[]>([]);
  const recordingDurationRef = useRef(0);
  const typingActive = useRef(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftBeforeEdit = useRef("");
  const editingId = useRef<string | null>(null);

  const updateVoiceCommand = useCallback((command: VoiceRecordCommand) => {
    voiceCommandRef.current = command;
    setVoiceCommand(command);
  }, []);

  const stopTyping = useCallback(() => {
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = null;
    if (!typingActive.current) return;
    typingActive.current = false;
    emitRealtimeTyping(streamId, false);
  }, [streamId]);

  useEffect(() => () => stopTyping(), [stopTyping]);
  useEffect(() => {
    const draft = useAppStore.getState().drafts[streamId] ?? "";
    stopTyping();
    setText(draft);
    setSelection({ start: draft.length, end: draft.length });
    setAttachmentSheet(false);
    setUploading(false);
    setRecorderMounted(false);
    setRecording(false);
    setRecordingLevels([]);
    setRecordingDuration(0);
    recordingWaveformSamples.current = [];
    recordingDurationRef.current = 0;
    updateVoiceCommand("idle");
    editingId.current = null;
  }, [stopTyping, streamId, updateVoiceCommand]);
  useEffect(() => {
    if (!editingMessage || editingId.current === editingMessage.id) return;
    draftBeforeEdit.current = useAppStore.getState().drafts[streamId] ?? "";
    editingId.current = editingMessage.id;
    setText(editingMessage.text);
    setSelection({ start: editingMessage.text.length, end: editingMessage.text.length });
  }, [editingMessage, streamId]);

  const restoreDraftAfterEditing = useCallback(() => {
    const draft = draftBeforeEdit.current;
    editingId.current = null;
    setText(draft);
    setSelection({ start: draft.length, end: draft.length });
  }, []);
  const cancelEditing = useCallback(() => {
    restoreDraftAfterEditing();
    onCancelEditing();
  }, [onCancelEditing, restoreDraftAfterEditing]);
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

  const mentionQuery = useMemo(
    () => (streamKind === "channel" || isGroup ? activeMentionQuery(text, selection.end) : null),
    [isGroup, selection.end, streamKind, text],
  );
  const suggestedMentions = useMemo(
    () => (mentionQuery ? mentionSuggestions(participants, mentionQuery.query, meId) : []),
    [meId, mentionQuery, participants],
  );
  const chooseMention = useCallback((username: string) => {
    if (!mentionQuery) return;
    const inserted = insertMention(text, mentionQuery, username);
    handleTextChange(inserted.text);
    setSelection({ start: inserted.caret, end: inserted.caret });
  }, [handleTextChange, mentionQuery, text]);
  const formatSelection = useCallback((format: TextFormat) => {
    const formatted = applyTextFormat(text, selection, format);
    handleTextChange(formatted.text);
    setSelection(formatted.selection);
  }, [handleTextChange, selection, text]);

  const sendText = useCallback(async (silent = false) => {
    const value = text.trim();
    if (!value) return;
    stopTyping();
    if (editingMessage) {
      restoreDraftAfterEditing();
      onEditingComplete();
      await editMessage(editingMessage, value);
      return;
    }
    setText("");
    setSelection({ start: 0, end: 0 });
    setDraft(streamId, "");
    const replyToId = replyingTo?.id ?? null;
    onCancelReply();
    await sendMessage(streamId, { text: value, kind: "text", replyToId, attachmentIds: [], silent });
    void Haptics.selectionAsync().catch(() => undefined);
  }, [editMessage, editingMessage, onCancelReply, onEditingComplete, replyingTo?.id, restoreDraftAfterEditing, sendMessage, setDraft, stopTyping, streamId, text]);

  const scheduleText = useCallback(async (delayMs: number) => {
    const value = text.trim();
    if (!value || editingMessage) return;
    setText("");
    setSelection({ start: 0, end: 0 });
    setDraft(streamId, "");
    const replyToId = replyingTo?.id ?? null;
    onCancelReply();
    await scheduleTextMessage(streamId, { text: value, kind: "text", replyToId, attachmentIds: [], silent: false }, Date.now() + delayMs);
  }, [editingMessage, onCancelReply, replyingTo?.id, scheduleTextMessage, setDraft, streamId, text]);

  const showSendOptions = useCallback(() => {
    if (!text.trim() || editingMessage) return;
    showDialog(t("sendOptions"), undefined, [
      { text: t("cancel"), style: "cancel" },
      { text: t("sendSilently"), onPress: () => void sendText(true) },
      { text: t("schedule15Minutes"), onPress: () => void scheduleText(15 * 60_000).catch(() => showDialog(t("requestFailed"), t("tryAgain"))) },
      { text: t("scheduleOneHour"), onPress: () => void scheduleText(60 * 60_000).catch(() => showDialog(t("requestFailed"), t("tryAgain"))) },
      { text: t("scheduleTomorrow"), onPress: () => void scheduleText(24 * 60 * 60_000).catch(() => showDialog(t("requestFailed"), t("tryAgain"))) },
    ]);
  }, [editingMessage, scheduleText, sendText, showDialog, t, text]);

  const handleUploads = useCallback(async (inputs: UploadInput[], messageKind: "media" | "file" | "video-note" | "voice" = "media") => {
    if (!inputs.length) return;
    const caption = messageKind === "voice" || messageKind === "video-note" ? "" : text.trim();
    setUploading(true);
    try {
      const task = sendAttachmentBatch(streamId, inputs, messageKind, replyingTo?.id ?? null, caption);
      setActiveTransferId(task.id);
      // Dismiss only after the intent and stable message IDs are durable. Byte
      // transfer and server dispatch continue independently in WorkManager.
      await task.accepted;
      // A post-acceptance failure belongs to the durable inline bubble. Its
      // Retry action reuses the original batch/client IDs and retries only the
      // failed transfer rows. Starting handleUploads again would create a
      // second logical message while the first native batch could still win.
      void task.completion.catch(() => undefined);
      if (caption) {
        setText("");
        setSelection({ start: 0, end: 0 });
        setDraft(streamId, "");
      }
      onCancelReply();
      setAttachmentSheet(false);
    } catch (error) {
      if (!isUploadCancelled(error)) {
        showDialog(t("uploadFailed"), userFacingError(error, t), [
          { text: t("cancel"), style: "cancel" },
          { text: t("retry"), onPress: () => void handleUploads(inputs, messageKind) },
        ]);
      }
    } finally {
      setActiveTransferId(null);
      setUploading(false);
    }
  }, [onCancelReply, replyingTo?.id, sendAttachmentBatch, setDraft, showDialog, streamId, t, text]);

  const beginRecording = useCallback(async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        updateVoiceCommand("idle");
        showDialog(t("microphoneRequired"), t("allowMicrophone"));
        return;
      }
      if (voiceCommandRef.current === "cancel" || voiceCommandRef.current === "idle") {
        updateVoiceCommand("idle");
        return;
      }
    } catch (error) {
      updateVoiceCommand("idle");
      showDialog(t("microphoneRequired"), userFacingError(error, t));
      return;
    }
    setRecorderMounted(true);
  }, [showDialog, t, updateVoiceCommand]);
  const startVoiceRecording = useCallback(() => {
    if (uploading || recording || voiceCommandRef.current !== "idle") return;
    stopVoicePlayback();
    setRecordingLevels([]);
    setRecordingDuration(0);
    recordingWaveformSamples.current = [];
    recordingDurationRef.current = 0;
    updateVoiceCommand("holding");
    void beginRecording();
  }, [beginRecording, recording, updateVoiceCommand, uploading]);
  const resetRecorder = useCallback(() => {
    updateVoiceCommand("idle");
    setRecording(false);
    setRecordingLevels([]);
    setRecordingDuration(0);
    setRecorderMounted(false);
  }, [updateVoiceCommand]);

  return {
    online, capabilities, uploadProgress, uploadQuality, microphoneMode, reducedMotion,
    text, selection, setSelection, attachmentSheet, setAttachmentSheet, uploading,
    recorderMounted, recording, setRecording, recordingLevels, recordingDuration,
    voiceCommand, updateVoiceCommand, suggestedMentions, chooseMention, formatSelection, cancelEditing,
    handleTextChange, sendText, showSendOptions, handleUploads, startVoiceRecording,
    resetRecorder,
    prepareVoiceUpload: (upload: UploadInput): UploadInput => ({
      ...upload,
      localWaveform: finalizeRecordingWaveform(recordingWaveformSamples.current),
      localDurationMs: recordingDurationRef.current,
    }),
    handleMetering: (metering: number | undefined, durationMillis: number) => {
      setRecordingLevels((levels) => appendRecordingLevel(levels, metering));
      setRecordingDuration(durationMillis);
      recordingWaveformSamples.current = appendRecordingWaveformSample(recordingWaveformSamples.current, metering);
      recordingDurationRef.current = durationMillis;
    },
    cancelUpload: () => cancelTransfer(activeTransferId ?? undefined),
  };
}
