import Ionicons from "@expo/vector-icons/Ionicons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Message, UploadQuality } from "@snezhok/contracts";

import { AttachmentSheet } from "../components/AttachmentSheet";
import { Avatar } from "../components/Avatar";
import { MessageActionsSheet } from "../components/MessageActionsSheet";
import { MessageBubble } from "../components/MessageBubble";
import { ScreenHeader } from "../components/ScreenHeader";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { api } from "../lib/api";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList, UploadInput } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

export function ChatScreen({ navigation, route }: Props) {
  const { streamId, streamKind, title } = route.params;
  const palette = usePalette();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<Message>>(null);
  const messages = useAppStore((state) => state.messages[streamId] ?? []);
  const me = useAppStore((state) => state.me);
  const conversations = useAppStore((state) => state.conversations);
  const conversation = conversations.find((item) => item.id === streamId);
  const peer = conversation?.saved ? undefined : conversation?.participants.find((participant) => participant.id !== me?.id) ?? conversation?.participants[0];
  const isGroup = useAppStore((state) => state.conversations.some((conversation) => conversation.id === streamId && conversation.kind === "group"));
  const online = useAppStore((state) => state.online);
  const loadMessages = useAppStore((state) => state.loadMessages);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const forwardMessage = useAppStore((state) => state.forwardMessage);
  const toggleReaction = useAppStore((state) => state.toggleReaction);
  const uploadQuality = useAppStore((state) => state.settings.defaultUploadQuality);
  const [text, setText] = useState("");
  const [recorderMounted, setRecorderMounted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [attachmentSheet, setAttachmentSheet] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  useEffect(() => { void loadMessages(streamId).catch(() => undefined); }, [loadMessages, streamId]);

  const sorted = useMemo(() => [...messages].sort((a, b) => a.sequence - b.sequence), [messages]);

  const sendText = async () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    const replyToId = replyingTo?.id ?? null;
    setReplyingTo(null);
    await sendMessage(streamId, { text: value, kind: "text", replyToId, attachmentIds: [] });
    void Haptics.selectionAsync().catch(() => undefined);
  };

  const handleUpload = async (input: UploadInput, messageKind: "media" | "file" | "video-note" | "voice" = "media") => {
    if (!online) return Alert.alert(t("offline"), t("attachmentOnline"));
    setUploading(true);
    try {
      const attachment = await api.upload(input);
      const replyToId = replyingTo?.id ?? null;
      setReplyingTo(null);
      await sendMessage(streamId, { text: "", kind: messageKind, replyToId, attachmentIds: [attachment.id] });
      setAttachmentSheet(false);
    } catch (error) {
      Alert.alert(t("uploadFailed"), error instanceof Error ? error.message : t("tryAgain"));
    } finally {
      setUploading(false);
    }
  };

  const beginRecording = async () => {
    if (!online) return Alert.alert(t("offline"), t("voiceOnline"));
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return Alert.alert(t("microphoneRequired"), t("allowMicrophone"));
    setRecorderMounted(true);
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const previous = index > 0 ? sorted[index - 1] : undefined;
    const showDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(item.createdAt).toDateString();
    const groupedWithPrevious = !showDay && previous?.sender.id === item.sender.id && item.createdAt - previous.createdAt <= 5 * 60_000;
    const showSender = (streamKind === "channel" || isGroup) && !groupedWithPrevious;
    return <View>{showDay ? <View style={styles.day}><View style={[styles.dayLine, { backgroundColor: palette.border }]} /><Text style={[styles.dayText, { color: palette.secondaryText }]}>{new Date(item.createdAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</Text><View style={[styles.dayLine, { backgroundColor: palette.border }]} /></View> : null}<MessageBubble message={item} mine={item.sender.id === me?.id} showSender={showSender} variant={streamKind === "channel" ? "channel" : "bubble"} onLongPress={() => { setSelectedMessage(item); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); }} onReact={(emoji) => void toggleReaction(item, emoji).catch(() => Alert.alert(t("requestFailed"), t("tryAgain")))} /></View>;
  };

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.background }]} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
      <ScreenHeader title={title} {...(route.params.subtitle ? { subtitle: route.params.subtitle } : {})} left={{ icon: "chevron-back", label: t("back"), onPress: navigation.goBack }} center={peer ? <Pressable onPress={() => navigation.navigate("Profile", { userId: peer.id })} style={styles.headerIdentity} accessibilityRole="button"><Avatar uri={peer.avatarUrl} label={peer.displayName} color={peer.avatarColor} online={peer.presence === "online"} size={34} /><View style={styles.headerCopy}><Text numberOfLines={1} style={[styles.headerTitle, { color: palette.text }]}>{peer.displayName}</Text><Text numberOfLines={1} style={[styles.headerSubtitle, { color: peer.presence === "online" ? palette.success : palette.secondaryText }]}>{peer.presence === "online" ? t("online") : t("lastSeen", { date: formatLastSeen(peer.lastSeenAt) })}</Text></View></Pressable> : undefined} right={streamKind === "conversation" ? [{ icon: "call-outline", label: t("startCall"), onPress: () => navigation.navigate("Call", { streamId, title }) }] : []} />
      <FlatList ref={list} data={sorted} keyExtractor={(item) => item.id} renderItem={renderMessage} contentContainerStyle={styles.list} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" removeClippedSubviews={Platform.OS === "android"} initialNumToRender={18} maxToRenderPerBatch={12} windowSize={7} onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })} ListEmptyComponent={<View style={styles.empty}><Text style={[styles.emptyTitle, { color: palette.text }]}>{title}</Text><Text style={[styles.emptyText, { color: palette.secondaryText }]}>{t("noMessages")}</Text></View>} />
      {recording ? <View style={[styles.recording, { backgroundColor: palette.surface }]}><View style={[styles.recordDot, { backgroundColor: palette.danger }]} /><Text style={[styles.recordingText, { color: palette.text }]}>{t("recording")}</Text><Text style={[styles.recordHint, { color: palette.secondaryText }]}>{t("tapStop")}</Text></View> : null}
      {replyingTo ? <View style={[styles.replyComposer, { backgroundColor: palette.surface, borderColor: palette.border }]}><View style={[styles.replyAccent, { backgroundColor: palette.accent }]} /><View style={styles.replyCopy}><Text numberOfLines={1} style={[styles.replyName, { color: palette.accent }]}>{replyingTo.sender.displayName}</Text><Text numberOfLines={1} style={[styles.replyText, { color: palette.secondaryText }]}>{replyingTo.text || t("attachment")}</Text></View><Pressable onPress={() => setReplyingTo(null)} style={styles.replyClose}><Ionicons name="close" size={21} color={palette.secondaryText} /></Pressable></View> : null}
      <View style={[styles.composer, { borderColor: palette.border, backgroundColor: palette.background, paddingBottom: Math.max(insets.bottom, 7) }]}> 
        <Pressable disabled={uploading || recording} onPress={() => setAttachmentSheet(true)} style={styles.composerButton} accessibilityLabel={t("attachFile")}><Ionicons name="add-circle-outline" size={27} color={uploading || recording ? palette.faintText : palette.accent} /></Pressable>
        <View style={[styles.inputWrap, { backgroundColor: palette.surface }]}><TextInput value={text} onChangeText={setText} editable={!recording} multiline maxLength={16_000} placeholder={recording ? t("recording") : t("message")} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text }]} /></View>
        {uploading ? <View style={styles.composerButton}><ActivityIndicator color={palette.accent} /></View> : text.trim() ? <Pressable onPress={() => void sendText()} style={[styles.send, { backgroundColor: palette.accent }]} accessibilityLabel={t("sendMessage")}><Ionicons name="arrow-up" size={21} color="white" /></Pressable> : recorderMounted ? <VoiceRecorderControl quality={uploadQuality} onRecordingChange={setRecording} onCancel={() => { setRecording(false); setRecorderMounted(false); }} onComplete={async (input) => { setRecording(false); setRecorderMounted(false); await handleUpload(input, "voice"); }} /> : <Pressable onPress={() => void beginRecording()} style={[styles.send, { backgroundColor: palette.accent }]} accessibilityLabel={t("recordVoice")}><Ionicons name="mic" size={20} color="white" /></Pressable>}
      </View>
      <AttachmentSheet visible={attachmentSheet} busy={uploading} onClose={() => setAttachmentSheet(false)} onSelect={handleUpload} />
      <MessageActionsSheet message={selectedMessage} conversations={conversations} onClose={() => setSelectedMessage(null)} onReply={(message) => { setSelectedMessage(null); setReplyingTo(message); }} onReact={(message, emoji) => { setSelectedMessage(null); void toggleReaction(message, emoji).catch(() => Alert.alert(t("requestFailed"), t("tryAgain"))); }} onForward={(message, conversation) => { setSelectedMessage(null); void forwardMessage(message.id, conversation.id).then(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => Alert.alert(t("requestFailed"), t("tryAgain"))); }} />
    </KeyboardAvoidingView>
  );
}

function VoiceRecorderControl({ quality, onRecordingChange, onCancel, onComplete }: { quality: UploadQuality; onRecordingChange: (value: boolean) => void; onCancel: () => void; onComplete: (input: UploadInput) => Promise<void> }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [started, setStarted] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        if (mounted.current) { setStarted(true); onRecordingChange(true); }
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      } catch (error) {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
        Alert.alert(t("microphoneRequired"), error instanceof Error ? error.message : t("tryAgain"));
        onCancel();
      }
    })();
    return () => { mounted.current = false; };
  }, [recorder]);

  const finish = async () => {
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!recorder.uri) throw new Error(t("tryAgain"));
      await onComplete({ uri: recorder.uri, filename: `voice-${Date.now()}.m4a`, mimeType: "audio/mp4", kind: "audio", quality });
    } catch (error) {
      Alert.alert(t("uploadFailed"), error instanceof Error ? error.message : t("tryAgain"));
      onCancel();
    }
  };

  if (!started) return <View style={styles.composerButton}><ActivityIndicator color={palette.accent} /></View>;
  return <Pressable onPress={() => void finish()} style={[styles.send, { backgroundColor: palette.danger }]} accessibilityLabel={t("stopRecording")}><Ionicons name="stop" size={20} color="white" /></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, list: { paddingVertical: 8, flexGrow: 1 },
  headerIdentity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 18 },
  headerCopy: { minWidth: 0, maxWidth: 150 }, headerTitle: { fontSize: 15, lineHeight: 18, fontWeight: "800" }, headerSubtitle: { fontSize: 11, lineHeight: 14, marginTop: 1 },
  day: { width: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, marginVertical: 10 }, dayLine: { flex: 1, height: StyleSheet.hairlineWidth }, dayText: { fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", paddingTop: 90, paddingHorizontal: 24 }, emptyTitle: { fontSize: 20, fontWeight: "800" }, emptyText: { fontSize: 14, marginTop: 6 },
  recording: { minHeight: 38, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 8 }, recordDot: { width: 9, height: 9, borderRadius: 5 }, recordingText: { fontSize: 13, fontWeight: "700" }, recordHint: { fontSize: 12, marginLeft: "auto" },
  replyComposer: { minHeight: 50, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 9 },
  replyAccent: { width: 3, alignSelf: "stretch", marginVertical: 8, borderRadius: 2 },
  replyCopy: { flex: 1 }, replyName: { fontSize: 12, fontWeight: "800" }, replyText: { fontSize: 12, marginTop: 2 }, replyClose: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
  composer: { minHeight: 54, flexDirection: "row", alignItems: "flex-end", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, paddingHorizontal: 6, gap: 5 }, composerButton: { width: 38, height: 40, alignItems: "center", justifyContent: "center" }, inputWrap: { flex: 1, minHeight: 39, maxHeight: 120, borderRadius: 19, justifyContent: "center" }, input: { fontSize: 16, lineHeight: 20, paddingHorizontal: 13, paddingVertical: 9, maxHeight: 120 }, send: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginBottom: 1 },
});

function formatLastSeen(timestamp: number): string {
  if (!timestamp) return "—";
  const value = new Date(timestamp);
  const now = new Date();
  if (value.toDateString() === now.toDateString()) return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return value.toLocaleDateString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
