import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { memo, useEffect, useId, useMemo, useState } from "react";
import { ActivityIndicator, type GestureResponderEvent, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { ClipPath, Defs, Path, Rect } from "react-native-svg";

import type { Attachment } from "@snezhok/contracts";

import { usePalette } from "../hooks/usePalette";
import { useAuthorizedMedia } from "../hooks/useAuthorizedMedia";
import { useTranslation } from "../i18n";
import {
  VOICE_WAVEFORM_HEIGHT,
  voiceWaveformBars,
  voiceWaveformPath,
} from "../lib/voiceWaveform";
import { AppIcon } from "./AppIcon";

const DEFAULT_WAVEFORM_WIDTH = 176;
const SEEK_STEP_SECONDS = 5;

export interface VoiceMessageAttachmentProps {
  attachment: Attachment;
}

/**
 * A lazy Telegram-style voice-note player.
 *
 * The native audio player is only allocated after the first play request. That
 * matters in long chat lists and on memory-constrained devices such as the A12.
 */
export const VoiceMessageAttachment = memo(function VoiceMessageAttachment({ attachment }: VoiceMessageAttachmentProps) {
  const [activated, setActivated] = useState(false);
  const source = useAuthorizedMedia(attachment.url);
  const bars = useMemo(() => voiceWaveformBars(attachment.waveform), [attachment.waveform]);

  if (activated) {
    return <ActiveVoiceMessage attachment={attachment} bars={bars} source={source} />;
  }
  return (
    <VoiceMessageFrame
      bars={bars}
      currentSeconds={attachmentDuration(attachment)}
      durationSeconds={attachmentDuration(attachment)}
      loading={false}
      playing={false}
      progress={0}
      onToggle={() => setActivated(true)}
    />
  );
});

interface ActiveVoiceMessageProps {
  attachment: Attachment;
  bars: readonly number[];
  source: ReturnType<typeof useAuthorizedMedia>;
}

function ActiveVoiceMessage({ attachment, bars, source }: ActiveVoiceMessageProps) {
  // 120ms is smooth enough for a continuously clipped fill without making a
  // low-end device reconcile the entire message row every animation frame.
  const player = useAudioPlayer(source, { updateInterval: 120 });
  const status = useAudioPlayerStatus(player);
  const fallbackDuration = attachmentDuration(attachment);
  const duration = positiveOr(status.duration, fallbackDuration);
  const currentTime = clamp(status.currentTime, 0, duration || Number.MAX_SAFE_INTEGER);
  const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;

  useEffect(() => {
    player.play();
  }, [player]);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || duration > 0 && currentTime >= duration - 0.05) {
      void player.seekTo(0).then(() => player.play());
      return;
    }
    player.play();
  };

  const seekToProgress = (nextProgress: number) => {
    if (duration <= 0) return;
    void player.seekTo(clamp(nextProgress, 0, 1) * duration);
  };

  const displayedTime = status.didJustFinish || currentTime <= 0 ? duration : currentTime;
  return (
    <VoiceMessageFrame
      bars={bars}
      currentSeconds={displayedTime}
      durationSeconds={duration}
      loading={status.isBuffering && !status.playing}
      playing={status.playing}
      progress={progress}
      onSeek={seekToProgress}
      onToggle={toggle}
    />
  );
}

interface VoiceMessageFrameProps {
  bars: readonly number[];
  currentSeconds: number;
  durationSeconds: number;
  loading: boolean;
  playing: boolean;
  progress: number;
  onToggle: () => void;
  onSeek?: (progress: number) => void;
}

function VoiceMessageFrame({ bars, currentSeconds, durationSeconds, loading, playing, progress, onToggle, onSeek }: VoiceMessageFrameProps) {
  const palette = usePalette();
  const { t } = useTranslation();
  const [waveformWidth, setWaveformWidth] = useState(DEFAULT_WAVEFORM_WIDTH);
  const generatedId = useId();
  const clipId = useMemo(() => `voice-progress-${generatedId.replace(/[^a-zA-Z0-9_-]/g, "")}`, [generatedId]);
  const waveformPath = useMemo(
    () => voiceWaveformPath(bars, waveformWidth, VOICE_WAVEFORM_HEIGHT),
    [bars, waveformWidth],
  );
  const clippedWidth = waveformWidth * clamp(progress, 0, 1);

  const seekFromEvent = (event: GestureResponderEvent) => {
    if (!onSeek || waveformWidth <= 0) return;
    onSeek(event.nativeEvent.locationX / waveformWidth);
  };
  const seekBy = (seconds: number) => {
    if (!onSeek || durationSeconds <= 0) return;
    const elapsed = clamp(progress, 0, 1) * durationSeconds;
    onSeek((elapsed + seconds) / durationSeconds);
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={t("voiceMessage")}
        accessibilityRole="button"
        onPress={onToggle}
        style={[styles.playButton, { backgroundColor: palette.accent }]}
      >
        {loading
          ? <ActivityIndicator color="white" size="small" />
          : <AppIcon name={playing ? "pause" : "play"} size={19} color="white" />}
      </Pressable>
      <View style={styles.content}>
        <Pressable
          accessibilityActions={[{ name: "decrement" }, { name: "increment" }]}
          accessibilityLabel={`${t("voiceMessage")}, ${formatDuration(currentSeconds)}`}
          accessibilityRole="adjustable"
          onAccessibilityAction={(event) => seekBy(event.nativeEvent.actionName === "increment" ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS)}
          onLayout={(event) => {
            const nextWidth = Math.max(1, Math.round(event.nativeEvent.layout.width));
            if (nextWidth !== waveformWidth) setWaveformWidth(nextWidth);
          }}
          onPress={onSeek ? seekFromEvent : onToggle}
          style={styles.waveform}
        >
          <Svg height={VOICE_WAVEFORM_HEIGHT} pointerEvents="none" width="100%">
            <Defs>
              <ClipPath id={clipId}>
                <Rect height={VOICE_WAVEFORM_HEIGHT} width={clippedWidth} x={0} y={0} />
              </ClipPath>
            </Defs>
            <Path d={waveformPath} fill="none" stroke={palette.faintText} strokeLinecap="round" strokeWidth={2} />
            <Path clipPath={`url(#${clipId})`} d={waveformPath} fill="none" stroke={palette.accent} strokeLinecap="round" strokeWidth={2} />
          </Svg>
        </Pressable>
        <Text style={[styles.time, { color: palette.secondaryText }]}>{formatDuration(currentSeconds || durationSeconds)}</Text>
      </View>
    </View>
  );
}

function attachmentDuration(attachment: Attachment): number {
  return Math.max(0, (attachment.durationMs ?? 0) / 1_000);
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  container: {
    width: 238,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  waveform: {
    width: "100%",
    height: VOICE_WAVEFORM_HEIGHT,
    justifyContent: "center",
  },
  time: {
    minHeight: 14,
    marginTop: 1,
    fontSize: 11,
    lineHeight: 13,
    fontVariant: ["tabular-nums"],
  },
});
