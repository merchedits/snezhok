import Ionicons from "@expo/vector-icons/Ionicons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlashList } from "@shopify/flash-list";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Message } from "@snezhok/contracts";

import { AttachmentSheet } from "../components/AttachmentSheet";
import { MessageBubble } from "../components/MessageBubble";
import { ScreenHeader } from "../components/ScreenHeader";
import { usePalette } from "../hooks/usePalette";
import { api } from "../lib/api";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList, UploadInput } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

export function ChatScreen({ navigation, route }: Props) {
  const { streamId, streamKind, title } = route.params;
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const messages = useAppStore((state) => state.messages[streamId] ?? []);
  const me = useAppStore((state) => state.me);
  const isGroup = useAppStore((state) => state.conversations.some((conversation) => conversation.id === streamId && conversation.kind === "group"));
  const online = useAppStore((state) => state.online);
  const loadMessages = useAppStore((state) => state.loadMessages);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const uploadQuality = useAppStore((state) => state.settings.defaultUploadQuality);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [attachmentSheet, setAttachmentSheet] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { void loadMessages(streamId).catch(() => undefined); }, [loadMessages, streamId]);

  const sorted = useMemo(() => [...messages].sort((a, b) => a.sequence - b.sequence), [messages]);

  const sendText = async () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    await sendMessage(streamId, { text: value, kind: "text", replyToId: null, attachmentIds: [] });
    void Haptics.selectionAsync();
  };

  const handleUpload = async (input: UploadInput, messageKind: "media" | "file" | "video-note" | "voice" = "media") => {
    if (!online) return Alert.alert("Offline", "Attachments need a connection. Text messages will be queued automatically.");
    setUploading(true);
    try {
      const attachment = await api.upload(input);
      await sendMessage(streamId, { text: "", kind: messageKind, replyToId: null, attachmentIds: [attachment.id] });
      setAttachmentSheet(false);
    } catch (error) {
      Alert.alert("Upload failed", error instanceof Error ? error.message : "Try again.");
    } finally {
      setUploading(false);
    }
  };

  const toggleVoiceRecording = async () => {
    if (recording) {
      await audioRecorder.stop();
      setRecording(false);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!audioRecorder.uri) return;
      await handleUpload({ uri: audioRecorder.uri, filename: `voice-${Date.now()}.m4a`, mimeType: "audio/mp4", kind: "audio", quality: uploadQuality }, "voice");
      return;
    }
    if (!online) return Alert.alert("Offline", "Voice messages need a connection to upload.");
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return Alert.alert("Microphone permission required", "Allow microphone access to record voice messages.");
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await audioRecorder.prepareToRecordAsync();
    audioRecorder.record();
    setRecording(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const previous = index > 0 ? sorted[index - 1] : undefined;
    const showDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(item.createdAt).toDateString();
    const groupedWithPrevious = !showDay && previous?.sender.id === item.sender.id && item.createdAt - previous.createdAt <= 5 * 60_000;
    const showSender = (streamKind === "channel" || isGroup) && !groupedWithPrevious;
    return (
      <View>
        {showDay ? <View style={styles.day}><View style={[styles.dayLine, { backgroundColor: palette.border }]} /><Text style={[styles.dayText, { color: palette.secondaryText }]}>{new Date(item.createdAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</Text><View style={[styles.dayLine, { backgroundColor: palette.border }]} /></View> : null}
        <MessageBubble message={item} mine={item.sender.id === me?.id} showSender={showSender} variant={streamKind === "channel" ? "channel" : "bubble"} />
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
      <ScreenHeader
        title={title}
        {...(route.params.subtitle ? { subtitle: route.params.subtitle } : {})}
        left={{ icon: "chevron-back", label: "Back", onPress: navigation.goBack }}
        right={streamKind === "conversation" ? [
          { icon: "call-outline", label: "Start call", onPress: () => navigation.navigate("Call", { streamId, title }) },
        ] : []}
      />
      <FlashList
        data={sorted}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.list}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
        ListEmptyComponent={<View style={styles.empty}><Text style={[styles.emptyTitle, { color: palette.text }]}>{title}</Text><Text style={[styles.emptyText, { color: palette.secondaryText }]}>This is the beginning of the conversation.</Text></View>}
      />
      {recording ? <View style={[styles.recording, { backgroundColor: palette.surface }]}><View style={[styles.recordDot, { backgroundColor: palette.danger }]} /><Text style={[styles.recordingText, { color: palette.text }]}>Recording voice message</Text><Text style={[styles.recordHint, { color: palette.secondaryText }]}>Tap stop to send</Text></View> : null}
      <View style={[styles.composer, { borderColor: palette.border, backgroundColor: palette.background, paddingBottom: Math.max(insets.bottom, 7) }]}> 
        <Pressable disabled={uploading || recording} onPress={() => setAttachmentSheet(true)} style={styles.composerButton} accessibilityLabel="Attach file">
          <Ionicons name="add-circle-outline" size={27} color={uploading || recording ? palette.faintText : palette.accent} />
        </Pressable>
        <View style={[styles.inputWrap, { backgroundColor: palette.surface }]}> 
          <TextInput
            value={text}
            onChangeText={setText}
            editable={!recording}
            multiline
            maxLength={16_000}
            placeholder={recording ? "Recording…" : "Message"}
            placeholderTextColor={palette.faintText}
            style={[styles.input, { color: palette.text }]}
          />
        </View>
        {uploading ? <View style={styles.composerButton}><ActivityIndicator color={palette.accent} /></View> : text.trim() ? (
          <Pressable onPress={() => void sendText()} style={[styles.send, { backgroundColor: palette.accent }]} accessibilityLabel="Send message"><Ionicons name="arrow-up" size={21} color="white" /></Pressable>
        ) : (
          <Pressable onPress={() => void toggleVoiceRecording()} style={[styles.send, { backgroundColor: recording ? palette.danger : palette.accent }]} accessibilityLabel={recording ? "Stop recording" : "Record voice message"}><Ionicons name={recording ? "stop" : "mic"} size={20} color="white" /></Pressable>
        )}
      </View>
      <AttachmentSheet visible={attachmentSheet} busy={uploading} onClose={() => setAttachmentSheet(false)} onSelect={handleUpload} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingVertical: 8 },
  day: { width: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, marginVertical: 10 },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dayText: { fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", paddingTop: 90, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, fontWeight: "800" },
  emptyText: { fontSize: 14, marginTop: 6 },
  recording: { minHeight: 38, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 8 },
  recordDot: { width: 9, height: 9, borderRadius: 5 },
  recordingText: { fontSize: 13, fontWeight: "700" },
  recordHint: { fontSize: 12, marginLeft: "auto" },
  composer: { minHeight: 54, flexDirection: "row", alignItems: "flex-end", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, paddingHorizontal: 6, gap: 5 },
  composerButton: { width: 38, height: 40, alignItems: "center", justifyContent: "center" },
  inputWrap: { flex: 1, minHeight: 39, maxHeight: 120, borderRadius: 19, justifyContent: "center" },
  input: { fontSize: 16, lineHeight: 20, paddingHorizontal: 13, paddingVertical: 9, maxHeight: 120 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginBottom: 1 },
});
