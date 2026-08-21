import type { Attachment } from "@snezhok/contracts";
import { Component, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";

import { recordDiagnostic } from "../../diagnostics/diagnostics";
import { useAuthorizedMedia } from "../../hooks/useAuthorizedMedia";
import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { mediaAlbumRows } from "../../lib/mediaAlbums";
import { messageMediaSize } from "../../lib/mediaLayout";
import { downloadAuthorizedMedia } from "../../lib/authorizedMediaDownload";
import { userFacingError } from "../../lib/userFacingError";
import { AppIcon } from "../AppIcon";
import { useAppDialog } from "../AppDialogProvider";
import { AuthenticatedImage } from "../AuthenticatedImage";
import { ImageViewer } from "../ImageViewer";
import { VideoViewer } from "../VideoViewer";
import { VoiceMessageAttachment } from "../VoiceMessageAttachment";
import { messageBubbleStyles as styles } from "./messageBubbleStyles";

export function MediaAlbum({ attachments }: { attachments: Attachment[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const rows = mediaAlbumRows(attachments);
  const rowHeight = rows.length === 1 ? 178 : rows.length === 2 ? 126 : 94;
  return (
    <>
      <View style={styles.album}>
        {rows.map((row) => (
          <View key={row.map((attachment) => attachment.id).join(":")} style={[styles.albumRow, { height: rowHeight }]}>
            {row.map((attachment) => <SafeAlbumMediaTile key={attachment.id} attachment={attachment} onOpen={() => setOpenIndex(attachments.indexOf(attachment))} />)}
          </View>
        ))}
      </View>
      {openIndex !== null ? <AlbumAttachmentViewer attachments={attachments} index={openIndex} onIndex={setOpenIndex} onClose={() => setOpenIndex(null)} /> : null}
    </>
  );
}

export function SafeAttachmentView({ attachment, streamId, mine, foreground, mutedForeground }: { attachment: Attachment; streamId: string; mine: boolean; foreground: string; mutedForeground: string }) {
  const palette = usePalette();
  const { t } = useTranslation();
  return (
    <AttachmentFailureBoundary attachmentId={attachment.id} backgroundColor={palette.surface} color={palette.secondaryText} label={t("attachment")}>
      <AttachmentView attachment={attachment} streamId={streamId} mine={mine} foreground={foreground} mutedForeground={mutedForeground} />
    </AttachmentFailureBoundary>
  );
}

function SafeAlbumMediaTile({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const palette = usePalette();
  const { t } = useTranslation();
  return (
    <AttachmentFailureBoundary attachmentId={attachment.id} backgroundColor={palette.surface} color={palette.secondaryText} label={t("attachment")} compact>
      <AlbumMediaTile attachment={attachment} onOpen={onOpen} />
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

function AlbumMediaTile({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  return (
    <Pressable testID={attachment.kind === "video" ? "message_video" : "message_image"} accessibilityRole="button" onPress={onOpen} style={styles.albumTile}>
      <AuthenticatedImage uri={attachment.thumbnailUrl ?? attachment.url} fallbackUri={attachment.thumbnailUrl ? attachment.url : null} cacheKey={`${attachment.id}-thumbnail`} mimeType={attachment.thumbnailUrl ? "image/webp" : attachment.mimeType} style={StyleSheet.absoluteFill} />
      {attachment.kind === "video" ? <><View style={styles.albumPlay}><AppIcon name="play" size={19} color="white" /></View>{attachment.durationMs ? <View style={styles.albumDuration}><Text style={styles.videoDurationText}>{formatDuration(attachment.durationMs / 1000)}</Text></View> : null}</> : null}
    </Pressable>
  );
}

function AlbumAttachmentViewer({ attachments, index, onIndex, onClose }: { attachments: Attachment[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const attachment = attachments[index]!;
  const source = useAuthorizedMedia(attachment.url);
  if (attachment.kind === "video") return <VideoViewer visible source={source} filename={attachment.filename} mimeType={attachment.mimeType} durationMs={attachment.durationMs} onClose={onClose} />;
  return <ImageViewer visible source={source} filename={attachment.filename} mimeType={attachment.mimeType} onClose={onClose} {...(index > 0 ? { onPrevious: () => onIndex(index - 1) } : {})} {...(index < attachments.length - 1 ? { onNext: () => onIndex(index + 1) } : {})} />;
}

function AttachmentView({ attachment, streamId, mine, foreground, mutedForeground }: { attachment: Attachment; streamId: string; mine: boolean; foreground: string; mutedForeground: string }) {
  if (attachment.kind === "image") return <ImageAttachment attachment={attachment} />;
  if (attachment.kind === "video") return <InlineVideo attachment={attachment} />;
  if (attachment.kind === "audio") return <VoiceMessageAttachment testID="message_voice" attachment={attachment} streamId={streamId} mine={mine} foreground={foreground} mutedForeground={mutedForeground} />;
  if (attachment.kind === "document") return <DocumentAttachment attachment={attachment} />;
  return null;
}

function DocumentAttachment({ attachment }: { attachment: Attachment }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const [opening, setOpening] = useState(false);
  const open = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      const safeName = attachment.filename.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-100) || "attachment.bin";
      const destination = new File(Paths.cache, `snezhok-${attachment.id}-${safeName}`);
      const completeCachedCopy = destination.exists && destination.size === attachment.bytes;
      const downloaded = completeCachedCopy ? destination : await downloadAuthorizedMedia(attachment.url, destination);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: downloaded.contentUri,
        type: attachment.mimeType || "application/octet-stream",
        flags: 1,
      });
    } catch (error) {
      recordDiagnostic("warn", "media", "Protected document open failed", { failure: error instanceof Error ? error.name : "UnknownError" });
      showDialog(t("requestFailed"), userFacingError(error, t));
    } finally {
      setOpening(false);
    }
  }, [attachment, opening, showDialog, t]);
  return (
    <Pressable disabled={opening} onPress={() => void open()} style={[styles.file, { backgroundColor: palette.surface }]}>
      <View style={[styles.fileIcon, { backgroundColor: palette.accentSoft }]}><AppIcon name="document-outline" size={23} color={palette.accent} /></View>
      <View style={styles.fileText}><Text numberOfLines={1} style={[styles.filename, { color: palette.text }]}>{attachment.filename}</Text><Text style={[styles.filesize, { color: palette.secondaryText }]}>{formatBytes(attachment.bytes)} · {attachment.quality}</Text></View>
      {opening ? <ActivityIndicator size="small" color={palette.accent} /> : <AppIcon name="download-outline" size={20} color={palette.accent} />}
    </Pressable>
  );
}

function ImageAttachment({ attachment }: { attachment: Attachment }) {
  const [open, setOpen] = useState(false);
  const [size, onIntrinsicSize] = useMediaFrame(attachment);
  return <><Pressable testID="message_image" onPress={() => setOpen(true)}><AuthenticatedImage uri={attachment.thumbnailUrl ?? attachment.url} fallbackUri={attachment.thumbnailUrl ? attachment.url : null} cacheKey={`${attachment.id}-thumbnail`} mimeType={attachment.thumbnailUrl ? "image/webp" : attachment.mimeType} resizeMode="contain" showLoader onIntrinsicSize={onIntrinsicSize} style={[styles.photo, size]} /></Pressable>{open ? <AttachmentViewer attachment={attachment} onClose={() => setOpen(false)} /> : null}</>;
}

function InlineVideo({ attachment }: { attachment: Attachment }) {
  const [open, setOpen] = useState(false);
  const [size, onIntrinsicSize] = useMediaFrame(attachment);
  return <><Pressable testID="message_video" accessibilityRole="button" onPress={() => setOpen(true)} style={[styles.videoPreview, size]}>{attachment.thumbnailUrl ? <AuthenticatedImage uri={attachment.thumbnailUrl} fallbackUri={attachment.url} cacheKey={`${attachment.id}-thumbnail`} mimeType="image/webp" onIntrinsicSize={onIntrinsicSize} style={styles.video} /> : <View style={[styles.video, styles.videoPlaceholder]} />}<View style={styles.videoPlay}><AppIcon name="play" size={23} color="white" /></View>{attachment.durationMs ? <View style={styles.videoDurationBadge}><Text style={styles.videoDurationText}>{formatDuration(attachment.durationMs / 1000)}</Text></View> : null}</Pressable>{open ? <AttachmentViewer attachment={attachment} onClose={() => setOpen(false)} /> : null}</>;
}

function useMediaFrame(attachment: Attachment): [ReturnType<typeof messageMediaSize>, (width: number, height: number) => void] {
  const [decodedSize, setDecodedSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => setDecodedSize(null), [attachment.id]);
  const onIntrinsicSize = useCallback((width: number, height: number) => setDecodedSize((current) => current?.width === width && current.height === height ? current : { width, height }), []);
  return [messageMediaSize(decodedSize?.width ?? attachment.width, decodedSize?.height ?? attachment.height), onIntrinsicSize];
}

function AttachmentViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const source = useAuthorizedMedia(attachment.url);
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
