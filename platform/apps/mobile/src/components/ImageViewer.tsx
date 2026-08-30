import { AppIcon } from "./AppIcon";
import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { prefetchAuthorizedMedia } from "../hooks/useAuthorizedMedia";
import { useTranslation } from "../i18n";
import { downloadAuthorizedMedia } from "../lib/authorizedMediaDownload";
import { userFacingError } from "../lib/userFacingError";
import { useAppDialog } from "./AppDialogProvider";
import { MediaGalleryVideoPage } from "./gallery/MediaGalleryVideoPage";
import { ZoomableImagePage, imageExtension } from "./gallery/ZoomableImagePage";
import type { ImageGalleryItem } from "./gallery/galleryTypes";
import { videoExtension } from "./VideoViewer";

export type { ImageGalleryItem } from "./gallery/galleryTypes";

type AuthorizedImageSource = {
  uri: string;
  headers: Record<string, string>;
};


export function ImageViewer({ visible, source, filename, mimeType, onClose }: { visible: boolean; source: AuthorizedImageSource; filename: string; mimeType: string; onClose: () => void }) {
  const items = useMemo<ImageGalleryItem[]>(() => [{ key: source.uri, uri: source.uri, filename, mimeType }], [filename, mimeType, source.uri]);
  return <ImageGalleryViewer visible={visible} items={items} initialIndex={0} onClose={onClose} />;
}

/**
 * A native horizontal pager is deliberately responsible for page movement.
 * The previous implementation translated one image and swapped its source only
 * after release, so a slow drag exposed an empty viewport. Adjacent pages now
 * move under the finger continuously, while a zoomed page temporarily owns pan.
 */
export function ImageGalleryViewer({ visible, items, initialIndex, onIndexChange, onClose }: {
  visible: boolean;
  items: readonly ImageGalleryItem[];
  initialIndex: number;
  onIndexChange?: (index: number) => void;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<ImageGalleryItem>>(null);
  const boundedInitialIndex = Math.max(0, Math.min(items.length - 1, initialIndex));
  const [activeIndex, setActiveIndex] = useState(boundedInitialIndex);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const dismissY = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    const nextIndex = Math.max(0, Math.min(items.length - 1, initialIndex));
    setActiveIndex(nextIndex);
    setScrollEnabled(true);
    dismissY.value = 0;
    requestAnimationFrame(() => list.current?.scrollToOffset({ offset: nextIndex * width, animated: false }));
  }, [dismissY, initialIndex, items.length, visible, width]);

  useEffect(() => {
    if (!visible || items.length === 0) return;
    const nearby = items.slice(Math.max(0, activeIndex - 1), Math.min(items.length, activeIndex + 2)).filter((item) => item.kind !== "video").map((item) => item.uri);
    void prefetchAuthorizedMedia(nearby).catch(() => false);
  }, [activeIndex, items, visible]);

  const settleIndex = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const next = Math.max(0, Math.min(items.length - 1, Math.round(event.nativeEvent.contentOffset.x / width)));
    setActiveIndex(next);
    setScrollEnabled(true);
    onIndexChange?.(next);
  }, [items.length, onIndexChange, width]);

  const activeItem = items[activeIndex];
  const dismissGesture = useMemo(() => Gesture.Pan()
    .enabled(scrollEnabled)
    .maxPointers(1)
    .activeOffsetY([-14, 14])
    .failOffsetX([-28, 28])
    .onUpdate((event) => {
      dismissY.value = Math.min(0, event.translationY);
    })
    .onEnd((event) => {
      const shouldClose = dismissY.value <= -Math.min(140, height * 0.16) || event.velocityY <= -850;
      if (shouldClose) {
        dismissY.value = withTiming(-height, { duration: 170 }, (finished) => {
          if (finished) runOnJS(onClose)();
        });
      } else {
        dismissY.value = withTiming(0, { duration: 150 });
      }
    }), [dismissY, height, onClose, scrollEnabled]);
  const dismissSurfaceStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dismissY.value, [-height, 0], [0.35, 1]),
    transform: [{ translateY: dismissY.value }],
  }), [height]);

  const saveMedia = useCallback(async () => {
    if (saving || !activeItem) return;
    setSaving(true);
    let temporaryFile: File | null = null;
    try {
      const isVideo = activeItem.kind === "video";
      const permission = await MediaLibrary.requestPermissionsAsync(true, [isVideo ? "video" : "photo"]);
      if (!permission.granted) {
        showDialog(t(isVideo ? "videoPermissionRequired" : "photoPermissionRequired"), t(isVideo ? "allowVideoSave" : "allowPhotoSave"));
        return;
      }
      const extension = isVideo ? videoExtension(activeItem.filename, activeItem.mimeType) : imageExtension(activeItem.filename, activeItem.mimeType);
      temporaryFile = new File(Paths.cache, `snezhok-${isVideo ? "video" : "photo"}-${Date.now()}.${extension}`);
      const downloaded = await downloadAuthorizedMedia(activeItem.uri, temporaryFile);
      await MediaLibrary.Asset.create(downloaded.uri);
      showDialog(t(isVideo ? "videoSaved" : "photoSaved"));
    } catch (error) {
      showDialog(t(activeItem.kind === "video" ? "videoSaveFailed" : "photoSaveFailed"), userFacingError(error, t));
    } finally {
      if (temporaryFile?.exists) temporaryFile.delete();
      setSaving(false);
    }
  }, [activeItem, saving, showDialog, t]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent={false} onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.viewer}>
        <GestureDetector gesture={dismissGesture}>
          <Animated.View style={[styles.dismissSurface, dismissSurfaceStyle]}>
            <FlatList
              ref={list}
              data={items as ImageGalleryItem[]}
              horizontal
              pagingEnabled
              scrollEnabled={scrollEnabled}
              directionalLockEnabled
              bounces={false}
              overScrollMode="never"
              decelerationRate="fast"
              disableIntervalMomentum
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={boundedInitialIndex}
              initialNumToRender={Math.min(3, items.length)}
              maxToRenderPerBatch={3}
              windowSize={3}
              keyExtractor={(item) => item.key}
              getItemLayout={(_data, index) => ({ length: width, offset: width * index, index })}
              onMomentumScrollEnd={settleIndex}
              onScrollEndDrag={(event) => {
                if (Math.abs(event.nativeEvent.velocity?.x ?? 0) < 0.01) settleIndex(event);
              }}
              renderItem={({ item, index }) => (
                item.kind === "video"
                  ? <MediaGalleryVideoPage item={item} width={width} height={height} active={index === activeIndex} />
                  : <ZoomableImagePage item={item} width={width} height={height} active={index === activeIndex} onZoomChange={(zoomed) => {
                    if (index === activeIndex) setScrollEnabled(!zoomed);
                  }} />
              )}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={t("closePhoto")} onPress={onClose} style={[styles.control, styles.close, { top: insets.top + 10 }]}>
              <AppIcon name="close" size={26} color="white" />
            </Pressable>
            <Pressable disabled={saving} accessibilityRole="button" accessibilityLabel={t(activeItem?.kind === "video" ? "saveVideo" : "savePhoto")} onPress={() => void saveMedia()} style={[styles.control, styles.download, { top: insets.top + 10 }]}>
              {saving ? <ActivityIndicator color="white" /> : <AppIcon name="download-outline" size={24} color="white" />}
            </Pressable>
            {items.length > 1 ? <View pointerEvents="none" style={[styles.counter, { top: insets.top + 18 }]}><Text style={styles.counterText}>{activeIndex + 1}/{items.length}</Text></View> : null}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: "transparent" },
  dismissSurface: { flex: 1, backgroundColor: "#000" },
  control: { position: "absolute", width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(18,22,29,0.76)" },
  close: { left: 12 },
  download: { right: 12 },
  counter: { position: "absolute", alignSelf: "center", minWidth: 54, height: 28, paddingHorizontal: 10, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(18,22,29,0.76)" },
  counterText: { color: "white", fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
});
