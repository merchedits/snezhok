import { useEventListener } from "expo";
import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTranslation } from "../i18n";
import { userFacingError } from "../lib/userFacingError";
import { useAppDialog } from "./AppDialogProvider";
import { AppIcon } from "./AppIcon";

type AuthorizedVideoSource = {
  uri: string;
  headers: Record<string, string>;
};

interface VideoViewerProps {
  visible: boolean;
  source: AuthorizedVideoSource;
  filename: string;
  mimeType: string;
  durationMs?: number | null | undefined;
  onClose: () => void;
}

export function VideoViewer(props: VideoViewerProps) {
  return (
    <Modal
      visible={props.visible}
      animationType="fade"
      statusBarTranslucent={false}
      navigationBarTranslucent={false}
      onRequestClose={props.onClose}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000000" translucent={false} />
      {props.visible ? <ActiveVideoViewer {...props} /> : null}
    </Modal>
  );
}

function ActiveVideoViewer({ source, filename, mimeType, durationMs, onClose }: VideoViewerProps) {
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const insets = useSafeAreaInsets();
  const [playing, setPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState((durationMs ?? 0) / 1000);
  const [scrubberWidth, setScrubberWidth] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const controlsOpacity = useSharedValue(1);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.25;
  });

  useEventListener(player, "playingChange", ({ isPlaying }) => setPlaying(isPlaying));
  useEventListener(player, "timeUpdate", (event) => setCurrentTime(event.currentTime));
  useEventListener(player, "sourceLoad", (event) => setDuration(event.duration));
  useEventListener(player, "playToEnd", () => {
    setPlaying(false);
    setControlsVisible(true);
    controlsOpacity.value = withTiming(1, { duration: 160 });
  });

  useEffect(() => {
    player.play();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [player]);

  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!playing || !controlsVisible) return;
    hideTimer.current = setTimeout(() => {
      setControlsVisible(false);
      controlsOpacity.value = withTiming(0, { duration: 180 });
    }, 2800);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [controlsOpacity, controlsVisible, playing]);

  const setControls = useCallback((visible: boolean) => {
    setControlsVisible(visible);
    controlsOpacity.value = withTiming(visible ? 1 : 0, { duration: 180 });
  }, [controlsOpacity]);

  const togglePlayback = useCallback(() => {
    if (playing) {
      player.pause();
      setControls(true);
      return;
    }
    if (duration > 0 && currentTime >= duration - 0.15) player.currentTime = 0;
    player.play();
    setControls(true);
  }, [currentTime, duration, player, playing, setControls]);

  const seek = useCallback((x: number) => {
    if (duration <= 0) return;
    const nextTime = Math.max(0, Math.min(1, x / scrubberWidth)) * duration;
    player.currentTime = nextTime;
    setCurrentTime(nextTime);
    setControls(true);
  }, [duration, player, scrubberWidth, setControls]);

  const saveVideo = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    let temporaryFile: File | null = null;
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true, ["video"]);
      if (!permission.granted) {
        showDialog(t("videoPermissionRequired"), t("allowVideoSave"));
        return;
      }
      temporaryFile = new File(Paths.cache, `snezhok-video-${Date.now()}.${videoExtension(filename, mimeType)}`);
      const task = File.createDownloadTask(source.uri, temporaryFile, { headers: source.headers });
      try {
        const downloaded = await task.downloadAsync();
        if (!downloaded?.exists) throw new Error(t("tryAgain"));
        await MediaLibrary.Asset.create(downloaded.uri);
      } finally {
        task.release();
      }
      showDialog(t("videoSaved"));
    } catch (error) {
      showDialog(t("videoSaveFailed"), userFacingError(error, t));
    } finally {
      if (temporaryFile?.exists) temporaryFile.delete();
      setSaving(false);
    }
  }, [filename, mimeType, saving, showDialog, source.headers, source.uri, t]);

  const controlsStyle = useAnimatedStyle(() => ({ opacity: controlsOpacity.value }));
  const progress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;

  return (
    <View accessibilityViewIsModal style={styles.viewer}>
      <VideoView
        player={player}
        nativeControls={false}
        contentFit="contain"
        surfaceType="surfaceView"
        style={StyleSheet.absoluteFill}
      />
      <Pressable
        accessibilityLabel={controlsVisible ? t("hideVideoControls") : t("showVideoControls")}
        onPress={() => setControls(!controlsVisible)}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View pointerEvents={controlsVisible ? "box-none" : "none"} style={[StyleSheet.absoluteFill, controlsStyle]}>
          <View pointerEvents="none" style={styles.topScrim} />
          <View pointerEvents="none" style={styles.bottomScrim} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("closeVideo")}
            onPress={onClose}
            style={[styles.roundControl, styles.close, { top: insets.top + 10 }]}
          >
            <AppIcon name="close" size={26} color="white" />
          </Pressable>
          <Pressable
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={t("saveVideo")}
            onPress={() => void saveVideo()}
            style={[styles.roundControl, styles.download, { top: insets.top + 10 }]}
          >
            {saving ? <ActivityIndicator color="white" /> : <AppIcon name="download-outline" size={24} color="white" />}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={playing ? t("pauseVideo") : t("playVideo")} onPress={togglePlayback} style={styles.playControl}>
            <AppIcon name={playing ? "pause" : "play"} size={34} color="white" />
          </Pressable>
          <View style={[styles.timeline, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
            <Text style={styles.time}>{formatVideoTime(currentTime)}</Text>
            <Pressable
              accessibilityRole="adjustable"
              accessibilityLabel={t("videoProgress")}
              onLayout={(event) => setScrubberWidth(Math.max(1, event.nativeEvent.layout.width))}
              onPress={(event) => seek(event.nativeEvent.locationX)}
              onTouchMove={(event) => seek(event.nativeEvent.locationX)}
              style={styles.scrubberTouchTarget}
            >
              <View style={styles.scrubberTrack}>
                <View style={[styles.scrubberProgress, { width: `${progress * 100}%` }]} />
                <View style={[styles.scrubberThumb, { left: `${progress * 100}%` }]} />
              </View>
            </Pressable>
            <Text style={styles.time}>{formatVideoTime(duration)}</Text>
          </View>
      </Animated.View>
    </View>
  );
}

export function videoExtension(filename: string, mimeType: string): "mp4" | "mov" | "webm" | "mkv" {
  const suffix = filename.toLowerCase().match(/\.(mp4|mov|webm|mkv)$/)?.[1];
  if (suffix === "mov" || suffix === "webm" || suffix === "mkv") return suffix;
  if (suffix === "mp4") return "mp4";
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/x-matroska") return "mkv";
  return "mp4";
}

function formatVideoTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: "#000000" },
  topScrim: { position: "absolute", top: 0, left: 0, right: 0, height: 116, backgroundColor: "rgba(0,0,0,0.28)" },
  bottomScrim: { position: "absolute", bottom: 0, left: 0, right: 0, height: 132, backgroundColor: "rgba(0,0,0,0.38)" },
  roundControl: { position: "absolute", width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(18,22,29,0.72)" },
  close: { left: 12 },
  download: { right: 12 },
  playControl: { position: "absolute", left: "50%", top: "50%", width: 64, height: 64, marginLeft: -32, marginTop: -32, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(10,12,16,0.62)" },
  timeline: { position: "absolute", left: 16, right: 16, bottom: 0, minHeight: 70, flexDirection: "row", alignItems: "center", gap: 10 },
  time: { width: 43, color: "white", fontSize: 12, fontVariant: ["tabular-nums"], textAlign: "center" },
  scrubberTouchTarget: { flex: 1, height: 42, justifyContent: "center" },
  scrubberTrack: { height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.42)" },
  scrubberProgress: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: "white" },
  scrubberThumb: { position: "absolute", top: -5, width: 13, height: 13, marginLeft: -6.5, borderRadius: 7, backgroundColor: "white" },
});
