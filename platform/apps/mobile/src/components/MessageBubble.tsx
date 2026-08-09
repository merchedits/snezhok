import { AppIcon } from "./AppIcon";
import { Image } from "expo-image";
import { Component, memo, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { type GestureResponderEvent, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";

import type { Attachment, Message } from "@snezhok/contracts";

import { recordDiagnostic } from "../diagnostics/diagnostics";
import { usePalette } from "../hooks/usePalette";
import { useUiPreferences } from "../hooks/useUiPreferences";
import { useAuthorizedMedia } from "../hooks/useAuthorizedMedia";
import { useTranslation } from "../i18n";
import { messageMediaSize } from "../lib/mediaLayout";
import { mediaAlbumRows } from "../lib/mediaAlbums";
import { renderableAttachments, renderableReactions } from "../lib/messagePayload";
import { Avatar } from "./Avatar";
import { ImageViewer } from "./ImageViewer";
import { VideoViewer } from "./VideoViewer";
import { VoiceMessageAttachment } from "./VoiceMessageAttachment";
import { CooperativeActivityCard } from "./CooperativeActivityCard";

interface MessageBubbleProps {
  streamId: string;
  message: Message;
  mine: boolean;
  showSender: boolean;
  variant: "bubble" | "channel";
  selected?: boolean;
  selectionMode?: boolean;
  selectionProgress: SharedValue<number>;
  onPress?: () => void;
  onLongPress?: () => void;
  onReact?: (emoji: string) => void;
  onOpenReactions?: (anchorY: number) => void;
  onReplyPress?: (messageId: string) => void;
  onOpenActivity?: () => void;
}

export const MessageBubble = memo(function MessageBubble({ streamId, message, mine, showSender, variant, selected = false, selectionMode = false, selectionProgress, onPress, onLongPress, onReact, onOpenReactions, onReplyPress, onOpenActivity }: MessageBubbleProps) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const lastTapAt = useRef(0);
  const tapAnchorY = useRef(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
  useEffect(() => () => {
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
  }, []);
  useEffect(() => {
    // FlashList recycles the native row for another message. Gesture state must
    // never leak from the previously displayed item into the recycled cell.
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    singleTapTimer.current = null;
    lastTapAt.current = 0;
    longPressTriggered.current = false;
  }, [message.id]);
  useEffect(() => {
    if (!selectionMode || !singleTapTimer.current) return;
    clearTimeout(singleTapTimer.current);
    singleTapTimer.current = null;
    lastTapAt.current = 0;
  }, [selectionMode]);
  const selectionContentStyle = useAnimatedStyle(() => ({
    // Incoming/direct and server messages need to clear the selector. Outgoing
    // bubbles already live on the opposite edge, so keeping them stationary
    // avoids clipping and leaves this as a compositor-only animation.
    transform: [{ translateX: mine && variant === "bubble" ? 0 : 34 * selectionProgress.value }],
  }));
  const selectionMarkerStyle = useAnimatedStyle(() => ({
    opacity: selectionProgress.value,
    transform: [{ scale: 0.76 + 0.24 * selectionProgress.value }],
  }));
  const handlePress = (event: GestureResponderEvent) => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    tapAnchorY.current = event.nativeEvent.pageY;
    if (selectionMode) {
      lastTapAt.current = 0;
      onPress?.();
      return;
    }
    const now = Date.now();
    if (now - lastTapAt.current <= 280) {
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      singleTapTimer.current = null;
      lastTapAt.current = 0;
      onReact?.("\u2764\uFE0F");
      return;
    }
    lastTapAt.current = now;
    singleTapTimer.current = setTimeout(() => {
      singleTapTimer.current = null;
      lastTapAt.current = 0;
      onOpenReactions?.(tapAnchorY.current);
    }, 280);
  };
  const handleLongPress = () => {
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    singleTapTimer.current = null;
    longPressTriggered.current = true;
    lastTapAt.current = 0;
    onLongPress?.();
  };
  if (message.deletedAt) return null;
  if (variant === "channel") {
    return (
      <View style={styles.selectionFrame}>
        <SelectionMarker selected={selected} animatedStyle={selectionMarkerStyle} />
        <Animated.View style={[styles.selectionContent, selectionContentStyle]}>
          <Pressable delayLongPress={240} onPress={handlePress} onLongPress={handleLongPress} style={({ pressed }) => [styles.channelRow, { paddingVertical: ui.dense(3, 1), opacity: pressed ? 0.72 : 1 }]}>
            <View style={styles.channelAvatar}>{showSender ? <Avatar uri={message.sender.avatarUrl} label={message.sender.displayName} color={message.sender.avatarColor} size={40} /> : null}</View>
            <View style={[styles.channelContent, selected && { backgroundColor: palette.accentSoft }]}>
              {showSender ? <View style={styles.authorLine}><Text style={[styles.channelAuthor, { color: message.sender.avatarColor || palette.text, fontSize: ui.font(15) }]}>{message.sender.displayName}</Text><Text style={[styles.channelTime, { color: palette.faintText, fontSize: ui.font(11) }]}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text></View> : null}
              <MessageContent streamId={streamId} message={message} mine={mine} foreground={palette.text} mutedForeground={palette.secondaryText} showSender={false} showTime={false} interactionDisabled={selectionMode} onReact={onReact} onReplyPress={onReplyPress} onOpenActivity={onOpenActivity} />
            </View>
          </Pressable>
        </Animated.View>
      </View>
    );
  }
  return (
    <View style={styles.selectionFrame}>
      <SelectionMarker selected={selected} animatedStyle={selectionMarkerStyle} />
      <Animated.View style={[styles.selectionContent, selectionContentStyle]}>
        <View style={[styles.row, mine ? styles.mineRow : styles.theirRow, { marginVertical: ui.dense(2, 1) }]}>
          <Pressable delayLongPress={240} onPress={message.activity ? undefined : handlePress} onLongPress={handleLongPress} style={({ pressed }) => [styles.bubble, message.activity && styles.activityBubble, mine ? styles.mineBubble : styles.theirBubble, { borderRadius: message.activity ? 24 : ui.bubbleRadius, paddingHorizontal: message.activity ? 0 : ui.dense(12, 10), paddingVertical: message.activity ? 0 : ui.dense(8, 5), backgroundColor: message.activity ? "transparent" : selected ? palette.accentSoft : mine ? palette.outgoing : palette.incoming, borderWidth: selected && !message.activity ? 1.5 : 0, borderColor: selected ? palette.accent : "transparent", opacity: pressed ? 0.82 : 1 }]}>
            <MessageContent streamId={streamId} message={message} mine={mine} foreground={selected || !mine ? palette.text : palette.onAccent} mutedForeground={selected || !mine ? palette.secondaryText : "rgba(255,255,255,0.76)"} showSender={showSender && !mine} showTime interactionDisabled={selectionMode} onReact={onReact} onReplyPress={onReplyPress} onOpenActivity={onOpenActivity} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}, (previous, next) => previous.message === next.message
  && previous.streamId === next.streamId
  && previous.mine === next.mine
  && previous.showSender === next.showSender
  && previous.variant === next.variant
  && previous.selected === next.selected
  && previous.selectionMode === next.selectionMode
  && previous.selectionProgress === next.selectionProgress);

function SelectionMarker({ selected, animatedStyle }: { selected: boolean; animatedStyle: ReturnType<typeof useAnimatedStyle> }) {
  const palette = usePalette();
  return (
    <Animated.View pointerEvents="none" style={[styles.selectionMarker, animatedStyle]}>
      <View style={[styles.selectionCircle, { borderColor: selected ? palette.accent : palette.faintText, backgroundColor: selected ? palette.accent : "transparent" }]}>
        {selected ? <AppIcon name="checkmark" size={15} color={palette.onAccent} strokeWidth={2} /> : null}
      </View>
    </Animated.View>
  );
}

function MessageContent({ streamId, message, mine, foreground, mutedForeground, showSender, showTime, interactionDisabled, onReact, onReplyPress, onOpenActivity }: { streamId: string; message: Message; mine: boolean; foreground: string; mutedForeground: string; showSender: boolean; showTime: boolean; interactionDisabled: boolean; onReact?: ((emoji: string) => void) | undefined; onReplyPress?: ((messageId: string) => void) | undefined; onOpenActivity?: (() => void) | undefined }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const { t } = useTranslation();
  const attachments = useMemo(() => renderableAttachments(message.attachments), [message.attachments]);
  const mediaAttachments = attachments.filter((attachment) => attachment.kind === "image" || attachment.kind === "video");
  const otherAttachments = mediaAttachments.length > 1 ? attachments.filter((attachment) => attachment.kind !== "image" && attachment.kind !== "video") : attachments;
  const reactions = useMemo(() => renderableReactions(message.reactions), [message.reactions]);
  if (message.activity) return <CooperativeActivityCard activity={message.activity} onOpen={() => onOpenActivity?.()} />;
  return (
    <View pointerEvents={interactionDisabled ? "none" : "auto"}>
      {showSender ? <Text style={[styles.sender, { color: message.sender.avatarColor || palette.accent, fontSize: ui.font(13) }]}>{message.sender.displayName}</Text> : null}
      {message.replyTo ? (
        <Pressable accessibilityRole="button" onPress={() => onReplyPress?.(message.replyTo!.id)} style={[styles.reply, { borderColor: palette.accent }]}>
          <Text numberOfLines={1} style={[styles.replyName, { color: palette.accent, fontSize: ui.font(12) }]}>{message.replyTo.senderName}</Text>
          <Text numberOfLines={1} style={[styles.replyText, { color: mutedForeground, fontSize: ui.font(12) }]}>{message.replyTo.text}</Text>
        </Pressable>
      ) : null}
      {message.forwardedFrom ? <View style={styles.forwarded}><AppIcon name="return-up-forward" size={13} color={palette.accent} /><Text numberOfLines={1} style={[styles.forwardedText, { color: palette.accent }]}>{message.forwardedFrom.senderName}</Text></View> : null}
      {mediaAttachments.length > 1 ? <MediaAlbum attachments={mediaAttachments} /> : null}
      {otherAttachments.map((attachment) => <SafeAttachmentView key={attachment.id} attachment={attachment} streamId={streamId} />)}
      {message.text ? <Text selectable={false} style={[styles.text, { color: foreground, fontSize: ui.font(16), lineHeight: ui.font(21) }]}>{message.text}</Text> : null}
      {showTime || message.editedAt || message.pinnedAt || (mine && (message.pending || message.failed)) ? (
        <View style={[styles.meta, !showTime && styles.channelMeta]}>
          {message.pinnedAt ? <View style={styles.pinned}><AppIcon name="pin" size={10} color={palette.accent} /><Text style={[styles.edited, { color: palette.accent }]}>{t("pinnedMessage")}</Text></View> : null}
          {message.editedAt ? <Text style={[styles.edited, { color: mutedForeground }]}>edited</Text> : null}
          {showTime ? <Text style={[styles.time, { color: mutedForeground }]}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text> : null}
          {mine ? <AppIcon name={message.failed ? "alert-circle" : message.pending ? "time-outline" : message.readByOthers ? "checkmark-done" : "checkmark"} size={14} color={message.failed ? palette.danger : foreground} /> : null}
        </View>
      ) : null}
      {reactions.length > 0 ? <View style={styles.reactions}>{reactions.map((reaction) => <Pressable accessibilityLabel={reaction.emoji} key={reaction.emoji} onPress={() => onReact?.(reaction.emoji)} style={[styles.reaction, { backgroundColor: reaction.reacted ? palette.accentSoft : palette.moment.pink, borderColor: reaction.reacted ? palette.accent : palette.outline }]}><Text style={styles.emoji}>{reaction.emoji}</Text></Pressable>)}</View> : null}
    </View>
  );
}

function MediaAlbum({ attachments }: { attachments: Attachment[] }) {
  const rows = mediaAlbumRows(attachments);
  const rowHeight = rows.length === 1 ? 178 : rows.length === 2 ? 126 : 94;
  return <View style={styles.album}>{rows.map((row) => <View key={row.map((attachment) => attachment.id).join(":")} style={[styles.albumRow, { height: rowHeight }]}>{row.map((attachment) => <SafeAlbumMediaTile key={attachment.id} attachment={attachment} />)}</View>)}</View>;
}

function SafeAttachmentView({ attachment, streamId }: { attachment: Attachment; streamId: string }) {
  const palette = usePalette();
  const { t } = useTranslation();
  return <AttachmentFailureBoundary attachmentId={attachment.id} backgroundColor={palette.surface} color={palette.secondaryText} label={t("attachment")}><AttachmentView attachment={attachment} streamId={streamId} /></AttachmentFailureBoundary>;
}

function SafeAlbumMediaTile({ attachment }: { attachment: Attachment }) {
  const palette = usePalette();
  const { t } = useTranslation();
  return <AttachmentFailureBoundary attachmentId={attachment.id} backgroundColor={palette.surface} color={palette.secondaryText} label={t("attachment")} compact><AlbumMediaTile attachment={attachment} /></AttachmentFailureBoundary>;
}

interface AttachmentFailureBoundaryProps {
  attachmentId: string;
  backgroundColor: string;
  color: string;
  label: string;
  compact?: boolean;
  children: ReactNode;
}

class AttachmentFailureBoundary extends Component<AttachmentFailureBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    recordDiagnostic("error", "media", "Attachment renderer was contained", { name: error.name });
  }

  componentDidUpdate(previous: AttachmentFailureBoundaryProps) {
    if (previous.attachmentId !== this.props.attachmentId && this.state.failed) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <View style={[this.props.compact ? styles.failedAttachmentCompact : styles.failedAttachment, { backgroundColor: this.props.backgroundColor }]}><AppIcon name="document-outline" size={20} color={this.props.color} /><Text numberOfLines={1} style={[styles.failedAttachmentText, { color: this.props.color }]}>{this.props.label}</Text></View>;
  }
}

function AlbumMediaTile({ attachment }: { attachment: Attachment }) {
  const [openAttachmentId, setOpenAttachmentId] = useState<string | null>(null);
  const open = openAttachmentId === attachment.id;
  const thumbnailSource = useAuthorizedMedia(attachment.thumbnailUrl ?? attachment.url);
  return <>
    <Pressable accessibilityRole="button" onPress={() => setOpenAttachmentId(attachment.id)} style={styles.albumTile}>
      <Image source={thumbnailSource} cachePolicy="memory-disk" contentFit="cover" recyclingKey={attachment.id} style={StyleSheet.absoluteFill} />
      {attachment.kind === "video" ? <><View style={styles.albumPlay}><AppIcon name="play" size={19} color="white" /></View>{attachment.durationMs ? <View style={styles.albumDuration}><Text style={styles.videoDurationText}>{formatDuration(attachment.durationMs / 1000)}</Text></View> : null}</> : null}
    </Pressable>
    {open ? <AttachmentViewer attachment={attachment} onClose={() => setOpenAttachmentId(null)} /> : null}
  </>;
}

function AttachmentView({ attachment, streamId }: { attachment: Attachment; streamId: string }) {
  const palette = usePalette();
  if (attachment.kind === "image") return <ImageAttachment attachment={attachment} />;
  if (attachment.kind === "video") return <InlineVideo attachment={attachment} />;
  if (attachment.kind === "audio") return <VoiceMessageAttachment attachment={attachment} streamId={streamId} />;
  return (
    <Pressable onPress={() => void Linking.openURL(attachment.url)} style={[styles.file, { backgroundColor: palette.surface }]}> 
      <View style={[styles.fileIcon, { backgroundColor: palette.accentSoft }]}><AppIcon name="document-outline" size={23} color={palette.accent} /></View>
      <View style={styles.fileText}><Text numberOfLines={1} style={[styles.filename, { color: palette.text }]}>{attachment.filename}</Text><Text style={[styles.filesize, { color: palette.secondaryText }]}>{formatBytes(attachment.bytes)} · {attachment.quality}</Text></View>
      <AppIcon name="download-outline" size={20} color={palette.accent} />
    </Pressable>
  );
}

function ImageAttachment({ attachment }: { attachment: Attachment }) {
  const [openAttachmentId, setOpenAttachmentId] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<{ attachmentId: string; width: number; height: number } | null>(null);
  const open = openAttachmentId === attachment.id;
  const thumbnailSource = useAuthorizedMedia(attachment.thumbnailUrl ?? attachment.url);
  const decodedSize = decoded?.attachmentId === attachment.id ? { width: decoded.width, height: decoded.height } : null;
  const size = decodedSize ?? messageMediaSize(attachment.width, attachment.height);
  const measurement = attachment.width && attachment.height ? {} : { onLoad: ({ source: loaded }: { source: { width: number; height: number } }) => setDecoded({ attachmentId: attachment.id, ...messageMediaSize(loaded.width, loaded.height) }) };
  return <><Pressable onPress={() => setOpenAttachmentId(attachment.id)}><Image source={thumbnailSource} cachePolicy="memory-disk" contentFit="cover" recyclingKey={attachment.id} {...measurement} style={[styles.photo, size]} /></Pressable>{open ? <AttachmentViewer attachment={attachment} onClose={() => setOpenAttachmentId(null)} /> : null}</>;
}

function InlineVideo({ attachment }: { attachment: Attachment }) {
  const thumbnailSource = useAuthorizedMedia(attachment.thumbnailUrl ?? "");
  const [openAttachmentId, setOpenAttachmentId] = useState<string | null>(null);
  const open = openAttachmentId === attachment.id;
  const size = messageMediaSize(attachment.width, attachment.height);
  return <>
    <Pressable accessibilityRole="button" onPress={() => setOpenAttachmentId(attachment.id)} style={[styles.videoPreview, size]}>
      {attachment.thumbnailUrl ? <Image source={thumbnailSource} cachePolicy="memory-disk" contentFit="cover" recyclingKey={attachment.id} style={styles.video} /> : <View style={[styles.video, styles.videoPlaceholder]} />}
      <View style={styles.videoPlay}><AppIcon name="play" size={23} color="white" /></View>
      {attachment.durationMs ? <View style={styles.videoDurationBadge}><Text style={styles.videoDurationText}>{formatDuration(attachment.durationMs / 1000)}</Text></View> : null}
    </Pressable>
    {open ? <AttachmentViewer attachment={attachment} onClose={() => setOpenAttachmentId(null)} /> : null}
  </>;
}

function AttachmentViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const source = useAuthorizedMedia(attachment.url);
  return attachment.kind === "video"
    ? <VideoViewer visible source={source} filename={attachment.filename} mimeType={attachment.mimeType} durationMs={attachment.durationMs} onClose={onClose} />
    : <ImageViewer visible source={source} filename={attachment.filename} mimeType={attachment.mimeType} onClose={onClose} />;
}

function formatBytes(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) && bytes >= 0 ? bytes : 0;
  if (safeBytes < 1024) return `${safeBytes} B`;
  if (safeBytes < 1024 * 1024) return `${Math.round(safeBytes / 1024)} KB`;
  return `${(safeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  selectionFrame: { width: "100%", position: "relative" },
  selectionContent: { width: "100%" },
  selectionMarker: { position: "absolute", left: 8, top: "50%", marginTop: -11, zIndex: 2 },
  selectionCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  row: { width: "100%", paddingHorizontal: 8, marginVertical: 2 },
  mineRow: { alignItems: "flex-end" },
  theirRow: { alignItems: "flex-start" },
  bubble: { maxWidth: "82%", minWidth: 78, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  mineBubble: { borderTopRightRadius: 8 },
  theirBubble: { borderTopLeftRadius: 8 },
  activityBubble: { maxWidth: "94%", width: 302, borderWidth: 0 },
  channelRow: { width: "100%", flexDirection: "row", paddingHorizontal: 12, paddingVertical: 3 },
  channelAvatar: { width: 40, marginRight: 10 },
  channelContent: { flex: 1, minWidth: 0, paddingRight: 8, borderRadius: 10 },
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
  photo: { borderRadius: 11, marginBottom: 5, backgroundColor: "#202329" },
  album: { width: 250, gap: 2, marginBottom: 5, borderRadius: 11, overflow: "hidden" },
  albumRow: { flexDirection: "row", gap: 2 },
  albumTile: { flex: 1, minWidth: 0, overflow: "hidden", backgroundColor: "#202329" },
  albumPlay: { position: "absolute", left: "50%", top: "50%", width: 36, height: 36, marginLeft: -18, marginTop: -18, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  albumDuration: { position: "absolute", right: 5, bottom: 5, minWidth: 30, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.62)" },
  video: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  videoPreview: { marginBottom: 5, borderRadius: 11, overflow: "hidden", backgroundColor: "#202329" },
  videoPlaceholder: { backgroundColor: "#202329" },
  videoPlay: { position: "absolute", left: "50%", top: "50%", width: 44, height: 44, marginLeft: -22, marginTop: -22, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  videoDurationBadge: { position: "absolute", right: 7, bottom: 7, minWidth: 34, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.62)" },
  videoDurationText: { color: "white", fontSize: 11, fontWeight: "600", fontVariant: ["tabular-nums"] },
  file: { width: 250, minHeight: 58, borderRadius: 11, padding: 8, flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 4 },
  fileIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  fileText: { flex: 1 },
  filename: { fontSize: 13, fontWeight: "600" },
  filesize: { fontSize: 11, marginTop: 3 },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 },
  reaction: { borderWidth: 1, borderRadius: 11, minWidth: 27, minHeight: 23, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 13 },
  failedAttachment: { width: 238, minHeight: 48, borderRadius: 11, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  failedAttachmentCompact: { flex: 1, minWidth: 0, height: "100%", alignItems: "center", justifyContent: "center" },
  failedAttachmentText: { flexShrink: 1, fontSize: 12, fontWeight: "700" },
});
