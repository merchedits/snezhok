import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuthorizedMedia } from "../../hooks/useAuthorizedMedia";
import { useTranslation } from "../../i18n";
import { AppIcon } from "../AppIcon";
import type { ImageGalleryItem } from "./galleryTypes";

export function MediaGalleryVideoPage({ item, width, height, active }: { item: ImageGalleryItem; width: number; height: number; active: boolean }) {
  const { t } = useTranslation();
  const source = useAuthorizedMedia(item.uri);
  const videoSource = useMemo(() => ({ ...source, useCaching: true, contentType: "progressive" as const }), [source.headers, source.uri]);
  const player = useVideoPlayer(videoSource, (instance) => {
    instance.loop = false;
    instance.bufferOptions = { preferredForwardBufferDuration: 6, minBufferForPlayback: 1.5, maxBufferBytes: 16 * 1024 * 1024, prioritizeTimeOverSizeThreshold: true };
  });
  const [playing, setPlaying] = useState(false);
  useEventListener(player, "playingChange", ({ isPlaying }) => setPlaying(isPlaying));
  useEffect(() => {
    if (active) return;
    player.pause();
  }, [active, player]);
  const togglePlayback = useCallback(() => {
    if (playing) player.pause();
    else player.play();
  }, [player, playing]);
  return (
    <View style={{ width, height }}>
      <VideoView player={player} nativeControls={false} contentFit="contain" surfaceType="textureView" style={StyleSheet.absoluteFill} />
      <Pressable accessibilityRole="button" accessibilityLabel={playing ? t("pauseVideo") : t("playVideo")} onPress={togglePlayback} style={styles.playControl}>
        <AppIcon name={playing ? "pause" : "play"} size={34} color="white" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({ playControl: { position: "absolute", left: "50%", top: "50%", width: 64, height: 64, marginLeft: -32, marginTop: -32, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(10,12,16,0.62)" } });
