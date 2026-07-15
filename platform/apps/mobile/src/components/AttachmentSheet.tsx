import { AppIcon } from "./AppIcon";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { userFacingError } from "../lib/userFacingError";
import type { UploadInput } from "../types";
import { useAppDialog } from "./AppDialogProvider";

interface AttachmentSheetProps {
  visible: boolean;
  busy: boolean;
  progress?: number | null;
  onClose: () => void;
  onSelect: (inputs: UploadInput[], messageKind?: "media" | "file" | "video-note") => Promise<void>;
}

type RecentAsset = MediaLibrary.AssetMetadata;
type DrawerItem = { type: "upload"; id: "upload-file" } | { type: "asset"; id: string; asset: RecentAsset };

const UPLOAD_ITEM: DrawerItem = { type: "upload", id: "upload-file" };
const MAX_RECENT_ASSETS = 72;
let recentAssetCache: RecentAsset[] = [];

/** Telegram-style recent-media drawer with a file-browser tile in place of Camera. */
export const AttachmentSheet = memo(function AttachmentSheet({ visible, busy, progress = null, onClose, onSelect }: AttachmentSheetProps) {
  const palette = usePalette();
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [assets, setAssets] = useState<RecentAsset[]>(recentAssetCache);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
  const [showMore, setShowMore] = useState(false);
  const [quality, setQuality] = useState<"auto" | "high">("auto");

  const refreshAssets = useCallback(async () => {
    setLoading(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(false, ["photo", "video"]);
      if (!permission.granted) {
        showDialog(t("permissionPhotos"), t("allowPhotos"));
        return;
      }
      const next = await new MediaLibrary.Query()
        .within(MediaLibrary.AssetField.MEDIA_TYPE, [MediaLibrary.MediaType.IMAGE, MediaLibrary.MediaType.VIDEO])
        .orderBy({ key: MediaLibrary.AssetField.CREATION_TIME, ascending: false })
        .limit(MAX_RECENT_ASSETS)
        .exeForMetadata();
      recentAssetCache = next;
      setAssets(next);
    } catch (error) {
      showDialog(t("requestFailed"), userFacingError(error, t));
    } finally {
      setLoading(false);
    }
  }, [showDialog, t]);

  useEffect(() => {
    if (!visible) return;
    setShowMore(false);
    setQuality("auto");
    setSelectedIds([]);
    setResolving(false);
    resolvingRef.current = false;
    void refreshAssets();
  }, [refreshAssets, visible]);

  const pickOriginalFile = useCallback(async () => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
      const asset = result.assets?.[0];
      if (!asset) return;
      await onSelect([{
        uri: asset.uri,
        filename: asset.name,
        mimeType: asset.mimeType ?? "application/octet-stream",
        kind: kindFromMimeType(asset.mimeType),
        quality: "original",
        purpose: "standard",
        stripLocation: false,
      }], "file");
    } finally {
      resolvingRef.current = false;
    }
  }, [onSelect]);

  const toggleRecentAsset = useCallback((asset: RecentAsset) => {
    if (busy || resolving) return;
    setSelectedIds((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id]);
  }, [busy, resolving]);

  const sendSelection = useCallback(async () => {
    if (!selectedIds.length || busy || resolvingRef.current) return;
    const selected = selectedIds.map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is RecentAsset => Boolean(asset));
    resolvingRef.current = true;
    setResolving(true);
    try {
      const infos = await Promise.all(selected.map(async (asset) => ({ asset, info: await new MediaLibrary.Asset(asset.id).getInfo() })));
      await onSelect(infos.map(({ asset, info }) => {
        const filename = info.filename || asset.filename || `media-${Date.now()}`;
        const video = info.mediaType === MediaLibrary.MediaType.VIDEO;
        return { uri: info.uri, filename, mimeType: mimeTypeFor(filename, video), kind: video ? "video" : "image", quality, purpose: "standard" };
      }), "media");
    } catch (error) {
      showDialog(t("uploadFailed"), userFacingError(error, t));
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  }, [assets, busy, onSelect, quality, resolving, selectedIds, showDialog, t]);

  const items = useMemo<DrawerItem[]>(() => [UPLOAD_ITEM, ...assets.map((asset) => ({ type: "asset" as const, id: asset.id, asset }))], [assets]);
  const tileSize = Math.floor((screenWidth - 4) / 3);
  const sheetHeight = Math.min(570, Math.max(360, Math.round(screenHeight * 0.68)));
  const visibleProgress = Math.max(0, Math.min(100, progress ?? 0));

  const renderItem = useCallback(({ item }: { item: DrawerItem }) => {
    if (item.type === "upload") {
      return (
        <Pressable
          accessibilityLabel={t("uploadFile")}
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void pickOriginalFile()}
          style={({ pressed }) => [styles.uploadTile, { width: tileSize, height: tileSize, backgroundColor: pressed ? palette.accentSoft : palette.surface, opacity: busy ? 0.5 : 1 }]}
        >
          <View style={[styles.uploadIcon, { backgroundColor: palette.accent }]}><AppIcon name="cloud-upload-outline" size={25} color="white" strokeWidth={2} /></View>
          <Text numberOfLines={2} style={[styles.uploadLabel, { color: palette.text }]}>{t("uploadFile")}</Text>
        </Pressable>
      );
    }
    const video = item.asset.mediaType === MediaLibrary.MediaType.VIDEO;
    const selectionIndex = selectedIds.indexOf(item.id);
    const selected = selectionIndex >= 0;
    return (
      <Pressable
        accessibilityLabel={item.asset.filename ?? t(video ? "videoMessage" : "photoVideo")}
        accessibilityRole="button"
        disabled={busy || resolving}
        onPress={() => toggleRecentAsset(item.asset)}
        style={({ pressed }) => [styles.assetTile, { width: tileSize, height: tileSize, opacity: pressed ? 0.72 : 1, borderColor: selected ? palette.accent : "transparent" }]}
      >
        <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={item.id} source={{ uri: item.id }} style={StyleSheet.absoluteFill} transition={0} />
        {video ? <View style={styles.videoBadge}><AppIcon name="play" size={11} color="white" strokeWidth={2.3} /><Text style={styles.videoDuration}>{formatDuration(item.asset.duration)}</Text></View> : null}
        {selected ? <View style={[styles.selectionBadge, { backgroundColor: palette.accent }]}><Text style={styles.selectionNumber}>{selectionIndex + 1}</Text></View> : null}
        {resolving && selected ? <View style={styles.assetPending}><ActivityIndicator color="white" /></View> : null}
      </Pressable>
    );
  }, [busy, palette.accent, palette.accentSoft, palette.surface, palette.text, pickOriginalFile, resolving, selectedIds, t, tileSize, toggleRecentAsset]);

  return (
    <Modal transparent visible={visible} animationType="slide" navigationBarTranslucent={false} onRequestClose={busy ? undefined : onClose}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <Pressable accessibilityLabel={t("cancel")} disabled={busy} onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { height: sheetHeight, backgroundColor: palette.elevated, paddingBottom: Math.max(insets.bottom, 8) }]}>
          <View style={styles.header}>
            <View style={[styles.handle, { backgroundColor: palette.faintText }]} />
            <Text style={[styles.title, { color: palette.text }]}>{quality === "high" ? `${t("recentMedia")} · HQ` : t("recentMedia")}</Text>
            <Pressable accessibilityLabel={t("moreSendingOptions")} accessibilityRole="button" disabled={busy} onPress={() => setShowMore((value) => !value)} style={({ pressed }) => [styles.moreButton, { backgroundColor: pressed || showMore ? palette.surface : "transparent" }]}>
              <AppIcon name="ellipsis-horizontal" size={22} color={palette.secondaryText} />
            </Pressable>
          </View>
          {showMore ? <View style={[styles.qualityMenu, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Pressable onPress={() => { setQuality("high"); setShowMore(false); }} style={({ pressed }) => [styles.qualityAction, { opacity: pressed ? 0.55 : 1 }]}>
              <AppIcon name="sparkles-outline" size={20} color={palette.accent} /><Text style={[styles.qualityLabel, { color: palette.text }]}>{t("sendAsHighQuality")}</Text>{quality === "high" ? <AppIcon name="checkmark" size={19} color={palette.accent} /> : null}
            </Pressable>
            <View style={[styles.qualityDivider, { backgroundColor: palette.border }]} />
            <Pressable onPress={() => void pickOriginalFile()} style={({ pressed }) => [styles.qualityAction, { opacity: pressed ? 0.55 : 1 }]}>
              <AppIcon name="document-outline" size={20} color={palette.accent} /><Text style={[styles.qualityLabel, { color: palette.text }]}>{t("sendAsOriginalFile")}</Text>
            </Pressable>
          </View> : null}
          <FlatList
            style={styles.gridList}
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            numColumns={3}
            columnWrapperStyle={styles.gridRow}
            removeClippedSubviews
            initialNumToRender={10}
            maxToRenderPerBatch={12}
            updateCellsBatchingPeriod={48}
            windowSize={5}
            contentContainerStyle={styles.grid}
            ListFooterComponent={loading ? <View style={[styles.loading, { width: screenWidth }]}><ActivityIndicator color={palette.accent} /></View> : null}
          />
          {selectedIds.length ? <View style={[styles.sendBar, { borderTopColor: palette.border, backgroundColor: palette.elevated }]}>
            <Pressable disabled={busy || resolving} onPress={() => void sendSelection()} style={({ pressed }) => [styles.sendButton, { backgroundColor: palette.accent, opacity: pressed || resolving ? 0.72 : 1 }]}>
              {resolving ? <ActivityIndicator color="white" /> : <><Text style={styles.sendText}>{t("sendSelected")}</Text><View style={styles.sendCount}><Text style={styles.sendCountText}>{selectedIds.length}</Text></View></>}
            </Pressable>
          </View> : null}
          {busy ? <View style={[styles.busy, { backgroundColor: palette.elevated }]}>
            {progress === null ? <ActivityIndicator color={palette.accent} /> : <CircularProgress progress={visibleProgress} activeColor={palette.accent} inactiveColor={palette.border} textColor={palette.text} />}
            <Text style={[styles.busyText, { color: palette.secondaryText }]}>{progress === null ? t("preparingUpload") : t("uploadingProgress", { progress: visibleProgress })}</Text>
          </View> : null}
        </View>
      </View>
    </Modal>
  );
});

function kindFromMimeType(mimeType: string | undefined): UploadInput["kind"] {
  if (mimeType?.startsWith("audio/")) return "audio";
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("image/")) return "image";
  return "document";
}

function mimeTypeFor(filename: string, video: boolean): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (video) {
    if (extension === "mov") return "video/quicktime";
    if (extension === "webm") return "video/webm";
    if (extension === "mkv") return "video/x-matroska";
    return "video/mp4";
  }
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "heic" || extension === "heif") return "image/heic";
  return "image/jpeg";
}

function formatDuration(milliseconds: number | null): string {
  const total = Math.max(0, Math.floor((milliseconds ?? 0) / 1_000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const progressSegments = Array.from({ length: 24 }, (_, index) => index);

function CircularProgress({ progress, activeColor, inactiveColor, textColor }: { progress: number; activeColor: string; inactiveColor: string; textColor: string }) {
  const size = 52; const dot = 4; const radius = 22; const center = size / 2;
  const activeSegments = Math.round((progress / 100) * progressSegments.length);
  return <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={{ width: size, height: size }}>
    {progressSegments.map((segment) => {
      const angle = ((segment / progressSegments.length) * Math.PI * 2) - (Math.PI / 2);
      return <View key={segment} style={{ position: "absolute", width: dot, height: dot, borderRadius: dot / 2, left: center + Math.cos(angle) * radius - dot / 2, top: center + Math.sin(angle) * radius - dot / 2, backgroundColor: segment < activeSegments ? activeColor : inactiveColor }} />;
    })}
    <View style={styles.progressLabel}><Text style={[styles.progressText, { color: textColor }]}>{progress}%</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: { overflow: "hidden", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  header: { height: 57, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  handle: { position: "absolute", width: 36, height: 4, borderRadius: 2, top: 7, left: "50%", marginLeft: -18, opacity: 0.5 },
  title: { flex: 1, marginTop: 5, fontSize: 18, fontWeight: "800" },
  moreButton: { width: 40, height: 40, marginTop: 5, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  grid: { paddingTop: 1 },
  gridList: { flex: 1 },
  gridRow: { gap: 2 },
  uploadTile: { marginBottom: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 10, gap: 8 },
  uploadIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  uploadLabel: { textAlign: "center", fontSize: 13, lineHeight: 16, fontWeight: "700" },
  assetTile: { marginBottom: 2, overflow: "hidden", borderWidth: 2, backgroundColor: "#11151a" },
  videoBadge: { position: "absolute", left: 6, bottom: 5, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 5, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.62)" },
  videoDuration: { color: "white", fontSize: 10, fontWeight: "800", fontVariant: ["tabular-nums"] },
  assetPending: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.42)" },
  selectionBadge: { position: "absolute", top: 6, right: 6, minWidth: 24, height: 24, paddingHorizontal: 5, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "white" },
  selectionNumber: { color: "white", fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  loading: { height: 52, alignItems: "center", justifyContent: "center" },
  qualityMenu: { marginHorizontal: 10, marginBottom: 8, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  qualityAction: { minHeight: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, gap: 10 },
  qualityLabel: { flex: 1, fontSize: 14, fontWeight: "600" },
  qualityDivider: { height: StyleSheet.hairlineWidth, marginLeft: 43 },
  sendBar: { minHeight: 64, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8 },
  sendButton: { height: 46, borderRadius: 23, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  sendText: { color: "white", fontSize: 15, fontWeight: "800" },
  sendCount: { minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  sendCountText: { color: "white", fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  busy: { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: 76, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 18, gap: 12, opacity: 0.96 },
  busyText: { fontSize: 13 },
  progressLabel: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  progressText: { fontSize: 10, fontWeight: "800", fontVariant: ["tabular-nums"] },
});
