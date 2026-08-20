import { AppIcon } from "./AppIcon";
import { Image } from "expo-image";
import { memo, useCallback } from "react";
import { ActivityIndicator, Animated, FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import type { UploadInput } from "../types";
import { attachmentSheetStyles as styles } from "./attachments/attachmentSheetStyles";
import { useAttachmentSheetController, type DrawerItem } from "./attachments/useAttachmentSheetController";

interface AttachmentSheetProps {
  visible: boolean;
  busy: boolean;
  progress?: number | null;
  onClose: () => void;
  onCancel?: () => void;
  imagesOnly?: boolean;
  onSelect: (inputs: UploadInput[], messageKind?: "media" | "file" | "video-note") => Promise<void>;
}

/** Telegram-style recent-media drawer with explicit original-file and camera actions. */
export const AttachmentSheet = memo(function AttachmentSheet({ visible, busy, progress = null, onClose, onCancel, imagesOnly = false, onSelect }: AttachmentSheetProps) {
  const palette = usePalette();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { items, loading, selectedIds, resolving, quality, qualityNotice, noticeOpacity, toggleHighQuality, pickOriginalFile, capturePhoto, toggleRecentAsset, sendSelection } = useAttachmentSheetController({ visible, busy, imagesOnly, onSelect });
  const tileSize = Math.floor((screenWidth - 4) / 3);
  const sheetHeight = Math.min(570, Math.max(360, Math.round(screenHeight * 0.68)));
  const visibleProgress = Math.max(0, Math.min(100, progress ?? 0));

  const renderItem = useCallback(
    ({ item }: { item: DrawerItem }) => {
      if (item.type === "upload") {
        return (
          <Pressable
            accessibilityLabel={t("uploadFile")}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void pickOriginalFile()}
            style={({ pressed }) => [
              styles.uploadTile,
              {
                width: tileSize,
                height: tileSize,
                backgroundColor: pressed ? palette.accentSoft : palette.surface,
                opacity: busy ? 0.5 : 1,
              },
            ]}
          >
            <View style={[styles.uploadIcon, { backgroundColor: palette.accent }]}>
              <AppIcon name="cloud-upload-outline" size={25} color="white" strokeWidth={2} />
            </View>
            <Text numberOfLines={2} style={[styles.uploadLabel, { color: palette.text }]}>
              {t("uploadFile")}
            </Text>
          </Pressable>
        );
      }
      if (item.type === "camera") {
        return (
          <Pressable
            accessibilityLabel={t("takePhoto")}
            accessibilityRole="button"
            disabled={busy || resolving}
            onPress={() => void capturePhoto()}
            style={({ pressed }) => [
              styles.uploadTile,
              {
                width: tileSize,
                height: tileSize,
                backgroundColor: pressed ? palette.accentSoft : palette.surface,
                opacity: busy || resolving ? 0.5 : 1,
              },
            ]}
          >
            <View style={[styles.uploadIcon, { backgroundColor: palette.success }]}>
              <AppIcon name="camera" size={25} color="white" strokeWidth={2} />
            </View>
            <Text numberOfLines={2} style={[styles.uploadLabel, { color: palette.text }]}>
              {t("takePhoto")}
            </Text>
          </Pressable>
        );
      }
      const video = item.asset.mediaType === "video";
      const selectionIndex = selectedIds.indexOf(item.id);
      const selected = selectionIndex >= 0;
      return (
        <Pressable
          accessibilityLabel={item.asset.filename ?? t(video ? "videoMessage" : "photoVideo")}
          accessibilityRole="button"
          disabled={busy || resolving}
          onPress={() => toggleRecentAsset(item.asset)}
          style={({ pressed }) => [
            styles.assetTile,
            {
              width: tileSize,
              height: tileSize,
              opacity: pressed ? 0.72 : 1,
              borderColor: selected ? palette.accent : "transparent",
            },
          ]}
        >
          <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={item.id} source={{ uri: item.id }} style={StyleSheet.absoluteFill} transition={0} />
          {video ? (
            <View style={styles.videoBadge}>
              <AppIcon name="play" size={11} color="white" strokeWidth={2.3} />
              <Text style={styles.videoDuration}>{formatDuration(item.asset.duration)}</Text>
            </View>
          ) : null}
          {selected ? (
            <View style={[styles.selectionBadge, { backgroundColor: palette.accent }]}>
              <Text style={styles.selectionNumber}>{selectionIndex + 1}</Text>
            </View>
          ) : null}
          {resolving && selected ? (
            <View style={styles.assetPending}>
              <ActivityIndicator color="white" />
            </View>
          ) : null}
        </Pressable>
      );
    },
    [busy, capturePhoto, palette.accent, palette.accentSoft, palette.success, palette.surface, palette.text, pickOriginalFile, resolving, selectedIds, t, tileSize, toggleRecentAsset],
  );

  return (
    <Modal transparent visible={visible} animationType="slide" navigationBarTranslucent={false} onRequestClose={busy ? undefined : onClose}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <Pressable accessibilityLabel={t("cancel")} disabled={busy} onPress={onClose} style={StyleSheet.absoluteFill} />
        <View
          testID="attachment_sheet"
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              backgroundColor: palette.elevated,
              paddingBottom: Math.max(insets.bottom + 8, 16),
            },
          ]}
        >
          <View style={styles.header}>
            <View style={[styles.handle, { backgroundColor: palette.faintText }]} />
            <Text style={[styles.title, { color: palette.text }]}>{t("recentMedia")}</Text>
            <Pressable
              accessibilityLabel={t(quality === "high" ? "disableHighQuality" : "enableHighQuality")}
              accessibilityRole="switch"
              accessibilityState={{ checked: quality === "high" }}
              disabled={busy || resolving}
              onPress={toggleHighQuality}
              style={({ pressed }) => [
                styles.hqButton,
                {
                  backgroundColor: quality === "high" ? palette.accent : palette.surface,
                  borderColor: quality === "high" ? palette.accent : palette.border,
                  opacity: pressed ? 0.68 : busy || resolving ? 0.5 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.hqButtonText,
                  {
                    color: quality === "high" ? "white" : palette.secondaryText,
                  },
                ]}
              >
                HQ
              </Text>
            </Pressable>
          </View>
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
            ListFooterComponent={
              loading ? (
                <View style={[styles.loading, { width: screenWidth }]}>
                  <ActivityIndicator color={palette.accent} />
                </View>
              ) : null
            }
          />
          {selectedIds.length ? (
            <View
              style={[
                styles.sendBar,
                {
                  borderTopColor: palette.border,
                  backgroundColor: palette.elevated,
                },
              ]}
            >
              <Pressable
                disabled={busy || resolving}
                onPress={() => void sendSelection()}
                style={({ pressed }) => [
                  styles.sendButton,
                  {
                    backgroundColor: palette.accent,
                    opacity: pressed || resolving ? 0.72 : 1,
                  },
                ]}
              >
                {resolving ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Text style={styles.sendText}>{t("sendSelected")}</Text>
                    <View style={styles.sendCount}>
                      <Text style={styles.sendCountText}>{selectedIds.length}</Text>
                    </View>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}
          {qualityNotice ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.qualityToast,
                {
                  backgroundColor: palette.text,
                  bottom: selectedIds.length ? 78 : 18,
                  opacity: noticeOpacity,
                  transform: [
                    {
                      translateY: noticeOpacity.interpolate({
                        inputRange: [0, 1],
                        outputRange: [6, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Text style={[styles.qualityToastText, { color: palette.elevated }]}>{qualityNotice}</Text>
            </Animated.View>
          ) : null}
          {busy ? (
            <View style={[styles.busy, { backgroundColor: palette.elevated }]}>
              {progress === null ? <ActivityIndicator color={palette.accent} /> : <CircularProgress progress={visibleProgress} activeColor={palette.accent} inactiveColor={palette.border} textColor={palette.text} />}
              <Text style={[styles.busyText, { color: palette.secondaryText }]}>{progress === null ? t("preparingUpload") : t("uploadingProgress", { progress: visibleProgress })}</Text>
              {onCancel ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={onCancel} style={[styles.cancelUpload, { backgroundColor: palette.surface }]}>
                  <AppIcon name="close" size={20} color={palette.secondaryText} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
});

function formatDuration(milliseconds: number | null): string {
  const total = Math.max(0, Math.floor((milliseconds ?? 0) / 1_000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const progressSegments = Array.from({ length: 24 }, (_, index) => index);

function CircularProgress({ progress, activeColor, inactiveColor, textColor }: { progress: number; activeColor: string; inactiveColor: string; textColor: string }) {
  const size = 52;
  const dot = 4;
  const radius = 22;
  const center = size / 2;
  const activeSegments = Math.round((progress / 100) * progressSegments.length);
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={{ width: size, height: size }}>
      {progressSegments.map((segment) => {
        const angle = (segment / progressSegments.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <View
            key={segment}
            style={{
              position: "absolute",
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              left: center + Math.cos(angle) * radius - dot / 2,
              top: center + Math.sin(angle) * radius - dot / 2,
              backgroundColor: segment < activeSegments ? activeColor : inactiveColor,
            }}
          />
        );
      })}
      <View style={styles.progressLabel}>
        <Text style={[styles.progressText, { color: textColor }]}>{progress}%</Text>
      </View>
    </View>
  );
}
