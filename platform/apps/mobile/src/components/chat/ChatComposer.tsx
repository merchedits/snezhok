import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Message, UserSummary } from "@snezhok/contracts";

import { AttachmentSheet } from "../AttachmentSheet";
import { AppIcon } from "../AppIcon";
import { useAppDialog } from "../AppDialogProvider";
import { TypingIndicator } from "../TypingIndicator";
import { usePalette } from "../../hooks/usePalette";
import { useUiPreferences } from "../../hooks/useUiPreferences";
import { useTranslation } from "../../i18n";
import { composerBottomPadding } from "../../lib/keyboardLayout";
import { RecordingStatus, VoiceGestureButton, VoiceRecorderControl } from "./ChatVoiceControls";
import { useChatComposerController } from "./useChatComposerController";

interface Props {
  streamId: string;
  streamKind: "conversation" | "channel";
  isGroup: boolean;
  participants: readonly UserSummary[];
  meId?: string;
  replyingTo: Message | null;
  editingMessage: Message | null;
  onCancelReply: () => void;
  onCancelEditing: () => void;
  onEditingComplete: () => void;
}

export function ChatComposer({
  streamId,
  streamKind,
  isGroup,
  participants,
  meId,
  replyingTo,
  editingMessage,
  onCancelReply,
  onCancelEditing,
  onEditingComplete,
}: Props) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const insets = useSafeAreaInsets();
  const controller = useChatComposerController({
    streamId, streamKind, isGroup, participants, meId, replyingTo, editingMessage,
    onCancelReply, onCancelEditing, onEditingComplete,
  });
  const {
    capabilities, uploadProgress, uploadQuality, microphoneMode, reducedMotion,
    text, selection, setSelection, attachmentSheet, setAttachmentSheet, uploading,
    recorderMounted, recording, setRecording, recordingLevels, recordingDuration,
    voiceCommand, updateVoiceCommand, suggestedMentions, chooseMention, formatSelection, cancelEditing,
    handleTextChange, sendText, showSendOptions, handleUploads, startVoiceRecording,
    resetRecorder, handleMetering, cancelUpload,
  } = controller;
  const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const composerClosedPadding = composerBottomPadding(insets.bottom, false);
  const composerOpenPadding = composerBottomPadding(insets.bottom, true);
  const composerKeyboardStyle = useAnimatedStyle(
    () => ({
      paddingBottom: interpolate(keyboardProgress.value, [0, 1], [composerClosedPadding, composerOpenPadding]),
    }),
    [composerClosedPadding, composerOpenPadding],
  );

  return (
    <>
      <TypingIndicator streamId={streamId} participants={participants} reducedMotion={reducedMotion} />
      {suggestedMentions.length ? <MentionSuggestions participants={suggestedMentions} onSelect={chooseMention} /> : null}
      {recording ? <RecordingStatus levels={recordingLevels} durationMillis={recordingDuration} locked={voiceCommand === "locked"} /> : null}
      {editingMessage ? (
        <ComposerContext title={t("editMessage")} text={editingMessage.text} onClose={cancelEditing} />
      ) : replyingTo ? (
        <ComposerContext title={replyingTo.sender.displayName} text={replyingTo.text || t("attachment")} onClose={onCancelReply} />
      ) : null}
      {selection.start !== selection.end ? <View style={[styles.formatBar, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <FormatButton label={t("bold")} text="B" onPress={() => formatSelection("bold")} />
        <FormatButton label={t("italic")} text="I" italic onPress={() => formatSelection("italic")} />
        <FormatButton label={t("monospace")} text="{ }" onPress={() => formatSelection("mono")} />
        <FormatButton label={t("quote")} text="❯" onPress={() => formatSelection("quote")} />
      </View> : null}
      <Animated.View
        style={[
          styles.composer,
          { minHeight: ui.dense(58, 52), borderColor: palette.outline, backgroundColor: palette.composer },
          composerKeyboardStyle,
        ]}
      >
        {voiceCommand === "locked" ? (
          <Pressable onPress={() => updateVoiceCommand("cancel")} style={styles.composerButton} accessibilityLabel={t("cancel")}>
            <AppIcon name="trash-outline" size={23} color={palette.danger} />
          </Pressable>
        ) : capabilities.uploads ? (
          <Pressable testID="chat_attach" disabled={uploading || voiceCommand !== "idle"} onPress={() => setAttachmentSheet(true)} style={styles.composerButton} accessibilityLabel={t("attachFile")}>
            <AppIcon name="add-circle-outline" size={27} color={uploading || voiceCommand !== "idle" ? palette.faintText : palette.accent} />
          </Pressable>
        ) : (
          <View style={styles.composerButton} />
        )}
        <View style={[styles.inputWrap, { minHeight: ui.dense(41, 37), borderRadius: Math.max(14, ui.bubbleRadius), backgroundColor: palette.elevated, borderColor: palette.outline }]}>
          <TextInput
            testID="chat_composer"
            value={text}
            selection={selection}
            onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
            onChangeText={handleTextChange}
            editable={!recording}
            multiline
            maxLength={16_000}
            placeholder={recording ? t("recording") : t("message")}
            placeholderTextColor={palette.faintText}
            style={[styles.input, { color: palette.text, fontSize: ui.font(16), lineHeight: ui.font(20), paddingVertical: ui.dense(9, 7) }]}
          />
        </View>
        {uploading ? (
          <View style={styles.composerButton}><ActivityIndicator color={palette.accent} /></View>
        ) : text.trim() ? (
          <Pressable
            testID="chat_send"
            delayLongPress={320}
            onPress={() => void sendText()}
            onLongPress={showSendOptions}
            style={[styles.send, { backgroundColor: palette.accent, borderColor: palette.outline }]}
            accessibilityLabel={t("sendMessage")}
          >
            <AppIcon name="arrow-up" size={21} color={palette.onAccent} strokeWidth={2} />
          </Pressable>
        ) : capabilities.uploads ? (
          <VoiceGestureButton testID="chat_voice" command={voiceCommand} disabled={uploading} onStart={startVoiceRecording} onLock={() => updateVoiceCommand("locked")} onCancel={() => updateVoiceCommand("cancel")} onFinish={() => updateVoiceCommand("finish")} />
        ) : (
          <View style={styles.composerButton} />
        )}
      </Animated.View>
      {recorderMounted ? (
        <VoiceRecorderControl
          command={voiceCommand}
          quality={uploadQuality}
          microphoneMode={microphoneMode}
          onRecordingChange={setRecording}
          onMetering={handleMetering}
          onTooShort={() => showDialog(t("voiceMessage"), t("voiceTooShort"))}
          onCancel={resetRecorder}
          onComplete={async (input) => {
            resetRecorder();
            await handleUploads([input], "voice");
          }}
        />
      ) : null}
      {capabilities.uploads ? (
        <AttachmentSheet
          visible={attachmentSheet}
          busy={uploading}
          progress={uploadProgress}
          onClose={() => setAttachmentSheet(false)}
          onCancel={() => void cancelUpload()}
          onSelect={handleUploads}
        />
      ) : null}
    </>
  );
}

function ComposerContext({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const palette = usePalette();
  return (
    <View style={[styles.context, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={[styles.contextAccent, { backgroundColor: palette.accent }]} />
      <View style={styles.contextCopy}>
        <Text numberOfLines={1} style={[styles.contextTitle, { color: palette.accent }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.contextText, { color: palette.secondaryText }]}>{text}</Text>
      </View>
      <Pressable onPress={onClose} style={styles.contextClose}>
        <AppIcon name="close" size={21} color={palette.secondaryText} />
      </Pressable>
    </View>
  );
}

function FormatButton({ label, text, italic = false, onPress }: { label: string; text: string; italic?: boolean; onPress: () => void }) {
  const palette = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.formatButton}><Text style={{ color: palette.text, fontWeight: "800", fontStyle: italic ? "italic" : "normal" }}>{text}</Text></Pressable>;
}

function MentionSuggestions({ participants, onSelect }: { participants: readonly UserSummary[]; onSelect: (username: string) => void }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const { t } = useTranslation();
  return (
    <View accessibilityLabel={t("people")} style={[styles.mentionList, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
      {participants.slice(0, 5).map((participant) => (
        <Pressable
          key={participant.id}
          accessibilityRole="button"
          accessibilityLabel={`${participant.displayName}, @${participant.username}`}
          onPress={() => onSelect(participant.username)}
          style={({ pressed }) => [styles.mentionRow, { minHeight: ui.dense(46, 40), backgroundColor: pressed ? palette.surface : "transparent" }]}
        >
          <View style={styles.mentionCopy}>
            <Text numberOfLines={1} style={[styles.mentionName, { color: palette.text, fontSize: ui.font(14) }]}>{participant.displayName}</Text>
            <Text numberOfLines={1} style={[styles.mentionUsername, { color: palette.secondaryText, fontSize: ui.font(12) }]}>@{participant.username}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  formatBar: { minHeight: 40, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 4 },
  formatButton: { minWidth: 42, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  mentionList: { maxHeight: 230, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 3 },
  mentionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 },
  mentionCopy: { flex: 1, minWidth: 0 },
  mentionName: { fontWeight: "700" },
  mentionUsername: { marginTop: 1 },
  context: { minHeight: 50, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 9 },
  contextAccent: { width: 3, alignSelf: "stretch", marginVertical: 8, borderRadius: 2 },
  contextCopy: { flex: 1 },
  contextTitle: { fontSize: 12, fontWeight: "800" },
  contextText: { fontSize: 12, marginTop: 2 },
  contextClose: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
  composer: { minHeight: 58, flexDirection: "row", alignItems: "flex-end", paddingTop: 7, paddingHorizontal: 8, gap: 6 },
  composerButton: { width: 38, height: 42, alignItems: "center", justifyContent: "center" },
  inputWrap: { flex: 1, minHeight: 41, maxHeight: 120, borderRadius: 18, justifyContent: "center" },
  input: { fontSize: 16, lineHeight: 20, paddingHorizontal: 13, paddingVertical: 9, maxHeight: 120 },
  send: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 1 },
});
