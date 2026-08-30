import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { clampImageTranslation, doubleTapImageTranslation, imagePanBounds } from "../../lib/imageViewerMath";
import { AuthenticatedImage } from "../AuthenticatedImage";
import type { ImageGalleryItem } from "./galleryTypes";

export function ZoomableImagePage({ item, width, height, active, onZoomChange }: { item: ImageGalleryItem; width: number; height: number; active: boolean; onZoomChange: (zoomed: boolean) => void }) {
  const scale = useSharedValue(1), savedScale = useSharedValue(1);
  const translateX = useSharedValue(0), translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0), savedTranslateY = useSharedValue(0);
  const imageWidth = useSharedValue(0), imageHeight = useSharedValue(0);
  const pinchFocalX = useSharedValue(0), pinchFocalY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);
  const reportZoom = useCallback((value: boolean) => { setZoomed(value); onZoomChange(value); }, [onZoomChange]);

  useEffect(() => {
    if (active) return;
    scale.value = 1; savedScale.value = 1;
    translateX.value = 0; translateY.value = 0;
    savedTranslateX.value = 0; savedTranslateY.value = 0;
    setZoomed(false);
  }, [active, savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY]);

  const pinch = useMemo(() => Gesture.Pinch()
    .onStart((event) => {
      savedScale.value = scale.value; savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value;
      pinchFocalX.value = event.focalX; pinchFocalY.value = event.focalY;
    })
    .onUpdate((event) => {
      const nextScale = Math.max(1, Math.min(6, savedScale.value * event.scale));
      const bounds = imagePanBounds(width, height, imageWidth.value, imageHeight.value, nextScale);
      const ratio = nextScale / Math.max(1, savedScale.value);
      const nextX = savedTranslateX.value * ratio + (pinchFocalX.value - width / 2) * (1 - ratio) + (event.focalX - pinchFocalX.value);
      const nextY = savedTranslateY.value * ratio + (pinchFocalY.value - height / 2) * (1 - ratio) + (event.focalY - pinchFocalY.value);
      scale.value = nextScale;
      translateX.value = clampImageTranslation(nextX, bounds.x); translateY.value = clampImageTranslation(nextY, bounds.y);
    })
    .onEnd(() => {
      const isZoomed = scale.value > 1.01;
      if (!isZoomed) {
        scale.value = withTiming(1); translateX.value = withTiming(0); translateY.value = withTiming(0);
        savedScale.value = 1; savedTranslateX.value = 0; savedTranslateY.value = 0;
      } else {
        savedScale.value = scale.value; savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value;
      }
      runOnJS(reportZoom)(isZoomed);
    }), [height, imageHeight, imageWidth, pinchFocalX, pinchFocalY, reportZoom, savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY, width]);

  const pan = useMemo(() => Gesture.Pan().enabled(zoomed).minDistance(2)
    .onBegin(() => { savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; })
    .onUpdate((event) => {
      const bounds = imagePanBounds(width, height, imageWidth.value, imageHeight.value, scale.value);
      translateX.value = clampImageTranslation(savedTranslateX.value + event.translationX, bounds.x);
      translateY.value = clampImageTranslation(savedTranslateY.value + event.translationY, bounds.y);
    })
    .onEnd(() => { savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; }),
  [height, imageHeight, imageWidth, savedTranslateX, savedTranslateY, scale, translateX, translateY, width, zoomed]);

  const doubleTap = useMemo(() => Gesture.Tap().numberOfTaps(2).maxDuration(280).onEnd((event) => {
    if (scale.value > 1) {
      scale.value = withTiming(1); savedScale.value = 1; translateX.value = withTiming(0); translateY.value = withTiming(0);
      savedTranslateX.value = 0; savedTranslateY.value = 0; runOnJS(reportZoom)(false); return;
    }
    const targetScale = 2.5;
    const bounds = imagePanBounds(width, height, imageWidth.value, imageHeight.value, targetScale);
    const targetX = doubleTapImageTranslation(width, event.x, targetScale, bounds.x);
    const targetY = doubleTapImageTranslation(height, event.y, targetScale, bounds.y);
    scale.value = withTiming(targetScale); savedScale.value = targetScale;
    translateX.value = withTiming(targetX); translateY.value = withTiming(targetY);
    savedTranslateX.value = targetX; savedTranslateY.value = targetY; runOnJS(reportZoom)(true);
  }), [height, imageHeight, imageWidth, reportZoom, savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY, width]);

  const gesture = useMemo(() => Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan)), [doubleTap, pan, pinch]);
  const imageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }] }));
  return <View style={{ width, height, overflow: "hidden" }}><GestureDetector gesture={gesture}><Animated.View collapsable={false} style={[styles.stage, imageStyle]}><AuthenticatedImage uri={item.uri} cacheKey={`${item.key}-viewer`} mimeType={item.mimeType} resizeMode="contain" showLoader onIntrinsicSize={(w, h) => { imageWidth.value = w; imageHeight.value = h; }} style={styles.image} /></Animated.View></GestureDetector></View>;
}

export function imageExtension(filename: string, mimeType: string): "jpg" | "png" | "webp" | "gif" {
  const suffix = filename.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/)?.[1];
  if (suffix === "jpeg" || suffix === "jpg") return "jpg";
  if (suffix === "png" || suffix === "webp" || suffix === "gif") return suffix;
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "jpg";
}

const styles = StyleSheet.create({ stage: { width: "100%", height: "100%" }, image: { width: "100%", height: "100%" } });
