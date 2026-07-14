import Ionicons from "@expo/vector-icons/Ionicons";
import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTranslation } from "../i18n";

type AuthorizedImageSource = {
  uri: string;
  headers: Record<string, string>;
};

export function ImageViewer({ visible, source, filename, mimeType, onClose }: { visible: boolean; source: AuthorizedImageSource; filename: string; mimeType: string; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const viewportWidth = useSharedValue(0);
  const viewportHeight = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY, visible]);

  const pinch = useMemo(() => Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.max(1, Math.min(4, savedScale.value * event.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    }), [savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY]);

  const pan = useMemo(() => Gesture.Pan()
    .maxPointers(2)
    .onBegin(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      if (scale.value <= 1) return;
      const maxX = Math.max(0, (viewportWidth.value * (scale.value - 1)) / (2 * scale.value));
      const maxY = Math.max(0, (viewportHeight.value * (scale.value - 1)) / (2 * scale.value));
      translateX.value = Math.max(-maxX, Math.min(maxX, savedTranslateX.value + event.translationX));
      translateY.value = Math.max(-maxY, Math.min(maxY, savedTranslateY.value + event.translationY));
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    }), [savedTranslateX, savedTranslateY, scale, translateX, translateY, viewportHeight, viewportWidth]);

  const doubleTap = useMemo(() => Gesture.Tap().numberOfTaps(2).maxDuration(250).onEnd(() => {
    if (scale.value > 1) {
      scale.value = withTiming(1);
      savedScale.value = 1;
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    } else {
      scale.value = withTiming(2.5);
      savedScale.value = 2.5;
    }
  }), [savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY]);

  const gesture = useMemo(() => Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan)), [doubleTap, pan, pinch]);
  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const savePhoto = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    let temporaryFile: File | null = null;
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true, ["photo"]);
      if (!permission.granted) {
        Alert.alert(t("photoPermissionRequired"), t("allowPhotoSave"));
        return;
      }
      const extension = imageExtension(filename, mimeType);
      temporaryFile = new File(Paths.cache, `snezhok-photo-${Date.now()}.${extension}`);
      const task = File.createDownloadTask(source.uri, temporaryFile, { headers: source.headers });
      try {
        const downloaded = await task.downloadAsync();
        if (!downloaded?.exists) throw new Error(t("tryAgain"));
        await MediaLibrary.Asset.create(downloaded.uri);
      } finally {
        task.release();
      }
      Alert.alert(t("photoSaved"));
    } catch (error) {
      Alert.alert(t("photoSaveFailed"), error instanceof Error ? error.message : t("tryAgain"));
    } finally {
      if (temporaryFile?.exists) temporaryFile.delete();
      setSaving(false);
    }
  }, [filename, mimeType, saving, source.headers, source.uri, t]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View
        accessibilityViewIsModal
        style={styles.viewer}
        onLayout={(event) => {
          viewportWidth.value = event.nativeEvent.layout.width;
          viewportHeight.value = event.nativeEvent.layout.height;
        }}
      >
        <GestureDetector gesture={gesture}>
          <Animated.Image accessibilityLabel={filename} source={source} style={[styles.image, imageStyle]} resizeMode="contain" />
        </GestureDetector>
        <Pressable accessibilityRole="button" accessibilityLabel={t("closePhoto")} onPress={onClose} style={[styles.control, styles.close, { top: insets.top + 10 }]}>
          <Ionicons name="close" size={26} color="white" />
        </Pressable>
        <Pressable disabled={saving} accessibilityRole="button" accessibilityLabel={t("savePhoto")} onPress={() => void savePhoto()} style={[styles.control, styles.download, { top: insets.top + 10 }]}>
          {saving ? <ActivityIndicator color="white" /> : <Ionicons name="download-outline" size={24} color="white" />}
        </Pressable>
      </View>
    </Modal>
  );
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

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: "100%", height: "100%" },
  control: { position: "absolute", width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(18, 22, 29, 0.76)" },
  close: { left: 12 },
  download: { right: 12 },
});
