import Ionicons from "@expo/vector-icons/Ionicons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { Attachment, Message } from "@snezhok/contracts";

import { usePalette } from "../hooks/usePalette";
import { useAuthorizedMedia } from "../hooks/useAuthorizedMedia";
import { useTranslation } from "../i18n";
import { voiceWaveformBars } from "../lib/voiceWaveform";
import { Avatar } from "./Avatar";
import { ImageViewer } from "./ImageViewer";

export function MessageBubble({ message, mine, showSender, variant, onLongPress, onReact }: { message: Message; mine: boolean; showSender: boolean; variant: "bubble" | "channel"; onLongPress?: () => void; onReact?: (emoji: string) => void }) {
  const palette = usePalette();
  if (message.deletedAt) return null;
  if (variant === "channel") {
    return (
      <Pressable delayLongPress={240} onLongPress={onLongPress} style={({ pressed }) => [styles.channelRow, { opacity: pressed ? 0.72 : 1 }]}>
        <View style={styles.channelAvatar}>{showSender ? <Avatar uri={message.sender.avatarUrl} label={message.sender.displayName} color={message.sender.avatarColor} size={40} /> : null}</View>
        <View style={styles.channelContent}>
          {showSender ? <View style={styles.authorLine}><Text style={[styles.channelAuthor, { color: message.sender.avatarColor || palette.text }]}>{message.sender.displayName}</Text><Text style={[styles.channelTime, { color: palette.faintText }]}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text></View> : null}
          <MessageContent message={message} mine={mine} showSender={false} showTime={false} onReact={onReact} />
        </View>
      </Pressable>
    );
  }
  return (
    <View style={[styles.row, mine ? styles.mineRow : styles.theirRow]}> 
      <Pressable delayLongPress={240} onLongPress={onLongPress} style={({ pressed }) => [styles.bubble, { backgroundColor: mine ? palette.outgoing : palette.incoming, borderColor: palette.border, transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
        <MessageContent message={message} mine={mine} showSender={showSender && !mine} showTime onReact={onReact} />
      </Pressable>
    </View>
  );
}

function MessageContent({ message, mine, showSender, showTime, onReact }: { message: Message; mine: boolean; showSender: boolean; showTime: boolean; onReact?: ((emoji: string) => void) | undefined }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const reactions = Array.isArray(message.reactions) ? message.reactions : [];
  return <>{showSender ? <Text style={[styles.sender, { color: message.sender.avatarColor || palette.accent }]}>{message.sender.displayName}</Text> : null}{message.replyTo ? <View style={[styles.reply, { borderColor: palette.accent }]}><Text numberOfLines={1} style={[styles.replyName, { color: palette.accent }]}>{message.replyTo.senderName}</Text><Text numberOfLines={1} style={[styles.replyText, { color: palette.secondaryText }]}>{message.replyTo.text}</Text></View> : null}{message.forwardedFrom ? <View style={styles.forwarded}><Ionicons name="return-up-forward" size={13} color={palette.accent} /><Text numberOfLines={1} style={[styles.forwardedText, { color: palette.accent }]}>{message.forwardedFrom.senderName}</Text></View> : null}{attachments.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment} />)}{message.text ? <Text selectable style={[styles.text, { color: palette.text }]}>{message.text}</Text> : null}{showTime || message.editedAt || message.pinnedAt || (mine && (message.pending || message.failed)) ? <View style={[styles.meta, !showTime && styles.channelMeta]}>{message.pinnedAt ? <View style={styles.pinned}><Ionicons name="pin" size={10} color={palette.accent} /><Text style={[styles.edited, { color: palette.accent }]}>{t("pinnedMessage")}</Text></View> : null}{message.editedAt ? <Text style={[styles.edited, { color: palette.faintText }]}>edited</Text> : null}{showTime ? <Text style={[styles.time, { color: palette.faintText }]}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text> : null}{mine ? <Ionicons name={message.failed ? "alert-circle" : message.pending ? "time-outline" : "checkmark-done"} size={14} color={message.failed ? palette.danger : palette.accent} /> : null}</View> : null}{reactions.length > 0 ? <View style={styles.reactions}>{reactions.map((reaction) => <Pressable key={reaction.emoji} onPress={() => onReact?.(reaction.emoji)} style={[styles.reaction, { backgroundColor: reaction.reacted ? palette.accentSoft : palette.surface, borderColor: reaction.reacted ? palette.accent : palette.border }]}><Text style={styles.emoji}>{reaction.emoji}</Text><Text style={[styles.reactionCount, { color: reaction.reacted ? palette.accent : palette.secondaryText }]}>{reaction.count}</Text></Pressable>)}</View> : null}</>;
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  const palette = usePalette();
  if (attachment.kind === "image") return <ImageAttachment attachment={attachment} />;
  if (attachment.kind === "video") return <InlineVideo attachment={attachment} />;
  if (attachment.kind === "audio") return <VoiceAttachment attachment={attachment} />;
  return (
    <Pressable onPress={() => void Linking.openURL(attachment.url)} style={[styles.file, { backgroundColor: palette.surface }]}> 
      <View style={[styles.fileIcon, { backgroundColor: palette.accentSoft }]}><Ionicons name="document-outline" size={23} color={palette.accent} /></View>
      <View style={styles.fileText}><Text numberOfLines={1} style={[styles.filename, { color: palette.text }]}>{attachment.filename}</Text><Text style={[styles.filesize, { color: palette.secondaryText }]}>{formatBytes(attachment.bytes)} · {attachment.quality}</Text></View>
      <Ionicons name="download-outline" size={20} color={palette.accent} />
    </Pressable>
  );
}

function ImageAttachment({ attachment }: { attachment: Attachment }) {
  const [open, setOpen] = useState(false);
  const source = useAuthorizedMedia(attachment.url);
  const thumbnailSource = useAuthorizedMedia(attachment.thumbnailUrl ?? attachment.url);
  return <><Pressable onPress={() => setOpen(true)}><Image source={thumbnailSource} style={styles.photo} resizeMode="cover" /></Pressable><ImageViewer visible={open} source={source} filename={attachment.filename} mimeType={attachment.mimeType} onClose={() => setOpen(false)} /></>;
}

function VoiceAttachment({ attachment }: { attachment: Attachment }) {
  const palette = usePalette();
  const source = useAuthorizedMedia(attachment.url);
  const player = useAudioPlayer(source, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [waveWidth, setWaveWidth] = useState(1);
  const bars = voiceWaveformBars(attachment.waveform);
  const duration = status.duration || (attachment.durationMs ?? 0) / 1000;
  const progress = Math.min(1, (status.currentTime || 0) / Math.max(duration, 1));
  const toggle = () => status.playing ? player.pause() : player.play();
  return (
    <View style={styles.voice}> 
      <Pressable onPress={toggle} style={[styles.play, { backgroundColor: palette.accent }]}><Ionicons name={status.playing ? "pause" : "play"} size={19} color="white" /></Pressable>
      <Pressable accessibilityRole="adjustable" onLayout={(event) => setWaveWidth(event.nativeEvent.layout.width)} onPress={(event) => void player.seekTo(Math.max(0, Math.min(1, event.nativeEvent.locationX / waveWidth)) * duration)} style={styles.wave}>
        {bars.map((height, index) => <View key={index} style={[styles.waveBar, { height, backgroundColor: index / bars.length <= progress ? palette.accent : palette.faintText }]} />)}
      </Pressable>
      <Text style={[styles.duration, { color: palette.secondaryText }]}>{formatDuration(status.playing ? status.currentTime : duration)}</Text>
    </View>
  );
}

function InlineVideo({ attachment }: { attachment: Attachment }) {
  const source = useAuthorizedMedia(attachment.url);
  const player = useVideoPlayer(source, (instance) => { instance.loop = false; });
  return <VideoView player={player} style={styles.video} nativeControls contentFit="cover" />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  row: { width: "100%", paddingHorizontal: 8, marginVertical: 2 },
  mineRow: { alignItems: "flex-end" },
  theirRow: { alignItems: "flex-start" },
  bubble: { maxWidth: "78%", minWidth: 78, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  channelRow: { width: "100%", flexDirection: "row", paddingHorizontal: 12, paddingVertical: 3 },
  channelAvatar: { width: 40, marginRight: 10 },
  channelContent: { flex: 1, minWidth: 0, paddingRight: 8 },
  authorLine: { flexDirection: "row", alignItems: "baseline", gap: 7, marginBottom: 2 },
  channelAuthor: { fontSize: 15, fontWeight: "700" },
  channelTime: { fontSize: 11 },
  channelMeta: { alignSelf: "flex-start", marginLeft: 0 },
  sender: { fontSize: 13, fontWeight: "700", marginBottom: 3 },
  text: { fontSize: 16, lineHeight: 21 },
  reply: { borderLeftWidth: 3, paddingLeft: 7, marginBottom: 6 },
  replyName: { fontSize: 12, fontWeight: "700" },
  replyText: { fontSize: 12, marginTop: 1 },
  forwarded: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 5 },
  forwardedText: { fontSize: 12, fontWeight: "700" },
  meta: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3, marginLeft: 12 },
  pinned: { flexDirection: "row", alignItems: "center", gap: 2 },
  time: { fontSize: 10 },
  edited: { fontSize: 10 },
  photo: { width: 250, height: 190, borderRadius: 11, marginBottom: 5, backgroundColor: "#202329" },
  video: { width: 250, height: 190, borderRadius: 11, marginBottom: 5, overflow: "hidden" },
  file: { width: 250, minHeight: 58, borderRadius: 11, padding: 8, flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 4 },
  fileIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  fileText: { flex: 1 },
  filename: { fontSize: 13, fontWeight: "600" },
  filesize: { fontSize: 11, marginTop: 3 },
  voice: { width: 230, minHeight: 45, flexDirection: "row", alignItems: "center", gap: 8 },
  play: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  wave: { flex: 1, height: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 1 },
  waveBar: { width: 2, minHeight: 4, borderRadius: 1 },
  duration: { fontSize: 11, width: 30 },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 },
  reaction: { borderWidth: 1, borderRadius: 10, minHeight: 22, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 3 },
  emoji: { fontSize: 12 },
  reactionCount: { fontSize: 10, fontWeight: "700" },
});
