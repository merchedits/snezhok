import type { Attachment } from "@snezhok/contracts";
import { Image as ExpoImage } from "expo-image";
import { Component, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";

import { recordDiagnostic } from "../../diagnostics/diagnostics";
import { useAuthorizedMedia } from "../../hooks/useAuthorizedMedia";
import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { mediaAlbumRows } from "../../lib/mediaAlbums";
import { messageMediaSize } from "../../lib/mediaLayout";
import { cancelAttachmentDownload, ensureAttachmentDownloaded, getAttachmentDownloadSnapshot, subscribeToAttachmentDownload } from "../../lib/attachmentDownloadManager";
import { userFacingError } from "../../lib/userFacingError";
import { AppIcon } from "../AppIcon";
import { useAppDialog } from "../AppDialogProvider";
import { AuthenticatedImage } from "../AuthenticatedImage";
import { ImageGalleryViewer, ImageViewer, type ImageGalleryItem } from "../ImageViewer";
import { VideoViewer } from "../VideoViewer";
import { VoiceMessageAttachment } from "../VoiceMessageAttachment";
import { messageBubbleStyles as styles } from "./messageBubbleStyles";

interface MediaMessageInteractions {
  onMessageReaction?: ((anchorY: number) => void) | undefined;
  onMessageLongPress?: (() => void) | undefined;
}

export function MediaAlbum({ attachments, pending = false, onMessageReaction, onMessageLongPress }: { attachments: Attachment[]; pending?: boolean } & MediaMessageInteractions) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const rows = mediaAlbumRows(attachments);
  const rowHeight = rows.length === 1 ? 178 : rows.length === 2 ? 126 : 94;
  return (
    <>
      <View style={styles.album}>
        {rows.map((row) => (
          <View key={row.map((attachment) => attachment.id).join(":")} style={[styles.albumRow, { height: rowHeight }]}>
            {row.map((attachment) => <SafeAlbumMediaTile key={attachment.id} attachment={attachment} pending={pending} onOpen={() => setOpenIndex(attachments.indexOf(attachment))} onMessageReaction={onMessageReaction} onMessageLongPress={onMessageLongPress} />)}
          </View>
        ))}
      </View>
      {openIndex !== null ? <AlbumAttachmentViewer attachments={attachments} index={openIndex} onIndex={setOpenIndex} onClose={() => setOpenIndex(null)} /> : null}
    </>
  );
}

export function SafeAttachmentView({ attachment, streamId, mine, foreground, mutedForeground, pending = false, onMessageReaction, onMessageLongPress }: { attachment: Attachment; streamId: string; mine: boolean; foreground: string; mutedForeground: string; pending?: boolean } & MediaMessageInteractions) {
  const palette = usePalette();
  const { t } = useTranslation();
  return (
    <View style={styles.pendingAttachmentFrame}>
      <AttachmentFailureBoundary attachmentId={attachment.id} backgroundColor={palette.surface} color={palette.secondaryText} label={t("attachment")}>
        <AttachmentView attachment={attachment} streamId={streamId} mine={mine} foreground={foreground} mutedForeground={mutedForeground} onMessageReaction={onMessageReaction} onMessageLongPress={onMessageLongPress} />
      </AttachmentFailureBoundary>
      <AttachmentTransferOverlay attachment={attachment} fallbackPending={pending} />
    </View>
  );
}

function SafeAlbumMediaTile({ attachment, pending, onOpen, onMessageReaction, onMessageLongPress }: { attachment: Attachment; pending: boolean; onOpen: () => void } & MediaMessageInteractions) {
  const palette = usePalette();
  const { t } = useTranslation();
  return (
    <AttachmentFailureBoundary attachmentId={attachment.id} backgroundColor={palette.surface} color={palette.secondaryText} label={t("attachment")} compact>
      <AlbumMediaTile attachment={attachment} pending={pending} onOpen={onOpen} onMessageReaction={onMessageReaction} onMessageLongPress={onMessageLongPress} />
    </AttachmentFailureBoundary>
  );
}

interface AttachmentFailureBoundaryProps { attachmentId: string; backgroundColor: string; color: string; label: string; compact?: boolean; children: ReactNode }

class AttachmentFailureBoundary extends Component<AttachmentFailureBoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    recordDiagnostic("error", "crash", "Isolated attachment render failure", { name: error.name, description: attachmentComponentName(info.componentStack) });
  }
  componentDidUpdate(previous: AttachmentFailureBoundaryProps) {
    if (previous.attachmentId !== this.props.attachmentId && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={[this.props.compact ? styles.failedAttachmentCompact : styles.failedAttachment, { backgroundColor: this.props.backgroundColor }]}>
        <AppIcon name="document-outline" size={20} color={this.props.color} />
        <Text numberOfLines={1} style={[styles.failedAttachmentText, { color: this.props.color }]}>{this.props.label}</Text>
      </View>
    );
  }
}

function attachmentComponentName(componentStack?: string | null): string {
  return componentStack?.match(/\bat ([A-Za-z][A-Za-z0-9_]*)\b/)?.[1] ?? "AttachmentComponent";
}

function AlbumMediaTile({ attachment, pending, onOpen, onMessageReaction, onMessageLongPress }: { attachment: Attachment; pending: boolean; onOpen: () => void } & MediaMessageInteractions) {
  const previewUri = localImagePreviewUri(attachment);
  return (
    <MediaPressSurface testID={attachment.kind === "video" ? "message_video" : "message_image"} onOpen={onOpen} onMessageReaction={onMessageReaction} onMessageLongPress={onMessageLongPress} style={styles.albumTile}>
      {previewUri
        ? <ExpoImage cachePolicy="none" contentFit="cover" recyclingKey={`${attachment.id}:local-preview`} source={{ uri: previewUri }} style={StyleSheet.absoluteFill} transition={0} />
        : <AuthenticatedImage uri={attachment.thumbnailUrl ?? attachment.url} fallbackUri={attachment.thumbnailUrl ? attachment.url : null} cacheKey={`${attachment.id}-thumbnail`} mimeType={attachment.thumbnailUrl ? "image/webp" : attachment.mimeType} style={StyleSheet.absoluteFill} />}
      <AttachmentTransferOverlay attachment={attachment} fallbackPending={pending} />
      {attachment.kind === "video" ? <><View style={styles.albumPlay}><AppIcon name="play" size={19} color="white" /></View>{attachment.durationMs ? <View style={styles.albumDuration}><Text style={styles.videoDurationText}>{formatDuration(attachment.durationMs / 1000)}</Text></View> : null}</> : null}
    </MediaPressSurface>
  );
}

type TransferDecoratedAttachment = Attachment & {
  localTransfer?: { status: string; progress: number; previewUri?: string | null };
};

function localImagePreviewUri(attachment: Attachment): string | null {
  if (attachment.kind !== "image") return null;
  return (attachment as TransferDecoratedAttachment).localTransfer?.previewUri ?? null;
}

function AttachmentTransferOverlay({ attachment, fallbackPending }: { attachment: Attachment; fallbackPending: boolean }) {
  const transfer = (attachment as TransferDecoratedAttachment).localTransfer;
  const failed = transfer?.status === "failed" || transfer?.status === "cancelled";
  const active = transfer ? !failed && transfer.status !== "succeeded" : fallbackPending;
  if (!active && !failed) return null;
  const progress = Math.max(0, Math.min(100, Math.round(transfer?.progress ?? 0)));
  return (
    <View pointerEvents="none" style={styles.pendingAttachmentMask}>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.attachmentProgressBadge}>
        {failed ? <AppIcon name="warning-outline" size={22} color="white" /> : <ActivityIndicator color="white" size={36} />}
      </View>
    </View>
  );
}

function AlbumAttachmentViewer({ attachments, index, onIndex, onClose }: { attachments: Attachment[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const galleryItems = useMemo<ImageGalleryItem[]>(() => attachments.map((item) => ({ key: item.id, uri: localImagePreviewUri(item) ?? item.url, filename: item.filename, mimeType: item.mimeType, kind: item.kind === "video" ? "video" : "image", durationMs: item.durationMs })), [attachments]);
  return <ImageGalleryViewer visible items={galleryItems} initialIndex={index} onIndexChange={onIndex} onClose={onClose} />;
}

function AttachmentView({ attachment, streamId, mine, foreground, mutedForeground, onMessageReaction, onMessageLongPress }: { attachment: Attachment; streamId: string; mine: boolean; foreground: string; mutedForeground: string } & MediaMessageInteractions) {
  if (attachment.kind === "image") return <ImageAttachment attachment={attachment} onMessageReaction={onMessageReaction} onMessageLongPress={onMessageLongPress} />;
  if (attachment.kind === "video") return <InlineVideo attachment={attachment} onMessageReaction={onMessageReaction} onMessageLongPress={onMessageLongPress} />;
  if (attachment.kind === "audio") return <VoiceMessageAttachment testID={`message_voice_${attachment.id}`} attachment={attachment} streamId={streamId} mine={mine} foreground={foreground} mutedForeground={mutedForeground} />;
  if (attachment.kind === "document") return <DocumentAttachment attachment={attachment} />;
  return null;
}

function DocumentAttachment({ attachment }: { attachment: Attachment }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const [action, setAction] = useState<"open" | "share" | null>(null);
  const download = useSyncExternalStore(
    useCallback((listener) => subscribeToAttachmentDownload(attachment.id, listener), [attachment.id]),
    useCallback(() => getAttachmentDownloadSnapshot(attachment.id), [attachment.id]),
    useCallback(() => getAttachmentDownloadSnapshot(attachment.id), [attachment.id]),
  );
  const run = useCallback(async (nextAction: "open" | "share") => {
    if (action || download.state === "downloading") return;
    setAction(nextAction);
    try {
      const downloaded = await ensureAttachmentDownloaded(attachment);
      const type = attachment.mimeType || "application/octet-stream";
      if (nextAction === "open") await IntentLauncher.startActivityAsync("android.intent.action.VIEW", { data: downloaded.contentUri, type, flags: 1 });
      else await IntentLauncher.startActivityAsync("android.intent.action.SEND", { type, flags: 1, extra: { "android.intent.extra.STREAM": downloaded.contentUri, "android.intent.extra.TITLE": attachment.filename } });
    } catch (error) {
      if (getAttachmentDownloadSnapshot(attachment.id).state === "cancelled") return;
      recordDiagnostic("warn", "media", "Protected document open failed", { failure: error instanceof Error ? error.name : "UnknownError" });
      showDialog(t("requestFailed"), userFacingError(error, t));
    } finally {
      setAction(null);
    }
  }, [action, attachment, download.state, showDialog, t]);
  const progressLabel = download.progress === null ? t("downloading") : `${Math.round(download.progress * 100)}%`;
  return (
    <Pressable onPress={() => void run("open")} style={[styles.file, { backgroundColor: palette.surface }]}>
      <View style={[styles.fileIcon, { backgroundColor: palette.accentSoft }]}><AppIcon name="document-outline" size={23} color={palette.accent} /></View>
      <View style={styles.fileText}><Text numberOfLines={1} style={[styles.filename, { color: palette.text }]}>{attachment.filename}</Text><Text style={[styles.filesize, { color: palette.secondaryText }]}>{download.state === "downloading" ? progressLabel : `${formatBytes(attachment.bytes)} · ${attachment.quality}`}</Text></View>
      {download.state === "downloading" ? <Pressable accessibilityRole="button" accessibilityLabel={t("cancelDownload")} hitSlop={8} onPress={(event) => { event.stopPropagation(); cancelAttachmentDownload(attachment.id); }}><AppIcon name="close" size={21} color={palette.accent} /></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={t("shareFile")} hitSlop={8} disabled={Boolean(action)} onPress={(event) => { event.stopPropagation(); void run("share"); }}><AppIcon name="return-up-forward-outline" size={20} color={palette.accent} /></Pressable>}
    </Pressable>
  );
}

function ImageAttachment({ attachment, onMessageReaction, onMessageLongPress }: { attachment: Attachment } & MediaMessageInteractions) {
  const [open, setOpen] = useState(false);
  const [size, onIntrinsicSize] = useMediaFrame(attachment);
  const previewUri = localImagePreviewUri(attachment);
  return <><MediaPressSurface testID={`message_image_${attachment.id}`} onOpen={() => setOpen(true)} onMessageReaction={onMessageReaction} onMessageLongPress={onMessageLongPress}>{previewUri ? <ExpoImage cachePolicy="none" contentFit="contain" recyclingKey={`${attachment.id}:local-preview`} source={{ uri: previewUri }} transition={0} onLoad={(event) => onIntrinsicSize(event.source.width, event.source.height)} style={[styles.photo, size]} /> : <AuthenticatedImage uri={attachment.thumbnailUrl ?? attachment.url} fallbackUri={attachment.thumbnailUrl ? attachment.url : null} cacheKey={`${attachment.id}-thumbnail`} mimeType={attachment.thumbnailUrl ? "image/webp" : attachment.mimeType} resizeMode="contain" showLoader onIntrinsicSize={onIntrinsicSize} style={[styles.photo, size]} />}</MediaPressSurface>{open ? <AttachmentViewer attachment={attachment} onClose={() => setOpen(false)} /> : null}</>;
}

function InlineVideo({ attachment, onMessageReaction, onMessageLongPress }: { attachment: Attachment } & MediaMessageInteractions) {
  const [open, setOpen] = useState(false);
  const [size, onIntrinsicSize] = useMediaFrame(attachment);
  return <><MediaPressSurface testID={`message_video_${attachment.id}`} onOpen={() => setOpen(true)} onMessageReaction={onMessageReaction} onMessageLongPress={onMessageLongPress} style={[styles.videoPreview, size]}>{attachment.thumbnailUrl ? <AuthenticatedImage uri={attachment.thumbnailUrl} fallbackUri={attachment.url} cacheKey={`${attachment.id}-thumbnail`} mimeType="image/webp" onIntrinsicSize={onIntrinsicSize} style={styles.video} /> : <View style={[styles.video, styles.videoPlaceholder]} />}<View style={styles.videoPlay}><AppIcon name="play" size={23} color="white" /></View>{attachment.durationMs ? <View style={styles.videoDurationBadge}><Text style={styles.videoDurationText}>{formatDuration(attachment.durationMs / 1000)}</Text></View> : null}</MediaPressSurface>{open ? <AttachmentViewer attachment={attachment} onClose={() => setOpen(false)} /> : null}</>;
}

function MediaPressSurface({ children, testID, style, onOpen, onMessageLongPress }: { children: ReactNode; testID: string; style?: StyleProp<ViewStyle>; onOpen: () => void } & MediaMessageInteractions) {
  const longPressHandled = useRef(false);
  const handlePress = () => {
    if (longPressHandled.current) {
      longPressHandled.current = false;
      return;
    }
    onOpen();
  };
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      delayLongPress={240}
      onPress={handlePress}
      onLongPress={() => {
        longPressHandled.current = true;
        onMessageLongPress?.();
      }}
      style={style}
    >
      {children}
    </Pressable>
  );
}

function useMediaFrame(attachment: Attachment): [ReturnType<typeof messageMediaSize>, (width: number, height: number) => void] {
  const [decodedSize, setDecodedSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => setDecodedSize(null), [attachment.id]);
  const onIntrinsicSize = useCallback((width: number, height: number) => setDecodedSize((current) => current?.width === width && current.height === height ? current : { width, height }), []);
  return [messageMediaSize(decodedSize?.width ?? attachment.width, decodedSize?.height ?? attachment.height), onIntrinsicSize];
}

function AttachmentViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const authorizedSource = useAuthorizedMedia(attachment.url);
  const previewUri = localImagePreviewUri(attachment);
  const source = previewUri ? { uri: previewUri, headers: {} } : authorizedSource;
  return attachment.kind === "video" ? <VideoViewer visible source={source} filename={attachment.filename} mimeType={attachment.mimeType} durationMs={attachment.durationMs} onClose={onClose} /> : <ImageViewer visible source={source} filename={attachment.filename} mimeType={attachment.mimeType} onClose={onClose} />;
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
