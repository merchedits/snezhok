import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, type GestureResponderEvent, Pressable, StyleSheet, Text, View } from "react-native";

import type { Attachment } from "@snezhok/contracts";

import { usePalette } from "../hooks/usePalette";
import { useCachedAuthorizedMedia } from "../hooks/useCachedAuthorizedMedia";
import { useTranslation } from "../i18n";
import {
  VOICE_WAVEFORM_HEIGHT,
  voiceWaveformBars,
} from "../lib/voiceWaveform";
import {
  completeVoicePlayback,
  cycleVoicePlaybackSpeed,
  pauseVoicePlayback,
  registerVoiceController,
  requestVoicePlayback,
  subscribeVoicePlayback,
  voicePlaybackSnapshot,
  type VoicePlaybackSpeed,
} from "../lib/voicePlaybackCoordinator";
import { AppIcon } from "./AppIcon";

const DEFAULT_WAVEFORM_WIDTH = 176;
const SEEK_STEP_SECONDS = 5;

export interface VoiceMessageAttachmentProps {
  attachment: Attachment;
  streamId: string;
  mine: boolean;
  foreground: string;
  mutedForeground: string;
}

/**
 * A lazy Telegram-style voice-note player.
 *
 * The native audio player is only allocated after the first play request. That
 * matters in long chat lists and on memory-constrained devices such as the A12.
 */
export const VoiceMessageAttachment = memo(function VoiceMessageAttachment({ attachment, streamId, mine, foreground, mutedForeground }: VoiceMessageAttachmentProps) {
  const playback = useSyncExternalStore(subscribeVoicePlayback, voicePlaybackSnapshot, voicePlaybackSnapshot);
  const activated = playback.requestedKey === `${streamId}:${attachment.id}`;
  const bars = useMemo(() => voiceWaveformBars(attachment.waveform), [attachment.waveform]);

  if (activated) {
    return <ActiveVoiceMessage attachment={attachment} bars={bars} speed={playback.speed} streamId={streamId} mine={mine} foreground={foreground} mutedForeground={mutedForeground} />;
  }
  return (
    <VoiceMessageFrame
      bars={bars}
      currentSeconds={attachmentDuration(attachment)}
      durationSeconds={attachmentDuration(attachment)}
      loading={false}
      playing={false}
      progress={0}
      speed={playback.speed}
      mine={mine}
      foreground={foreground}
      mutedForeground={mutedForeground}
      onSpeedChange={cycleVoicePlaybackSpeed}
      onToggle={() => requestVoicePlayback(streamId, attachment.id)}
    />
  );
});

interface ActiveVoiceMessageProps {
  attachment: Attachment;
  bars: readonly number[];
  speed: VoicePlaybackSpeed;
  streamId: string;
  mine: boolean;
  foreground: string;
  mutedForeground: string;
}

function ActiveVoiceMessage({ attachment, bars, speed, streamId, mine, foreground, mutedForeground }: ActiveVoiceMessageProps) {
  const media = useCachedAuthorizedMedia(attachment.url, attachment.primaryChecksum ?? attachment.checksum ?? attachment.id, attachment.mimeType);
  if (!media.uri) {
    return <VoiceMessageFrame bars={bars} currentSeconds={attachmentDuration(attachment)} durationSeconds={attachmentDuration(attachment)} loading={media.loading} failed={media.failed} playing={false} progress={0} speed={speed} mine={mine} foreground={foreground} mutedForeground={mutedForeground} onSpeedChange={cycleVoicePlaybackSpeed} onToggle={media.failed ? media.retry : () => undefined} />;
  }
  return <LoadedVoiceMessage attachment={attachment} bars={bars} localUri={media.uri} speed={speed} streamId={streamId} mine={mine} foreground={foreground} mutedForeground={mutedForeground} />;
}

function LoadedVoiceMessage({ attachment, bars, localUri, speed, streamId, mine, foreground, mutedForeground }: Omit<ActiveVoiceMessageProps, "source"> & { localUri: string }) {
  // 120ms is smooth enough for a continuously clipped fill without making a
  // low-end device reconcile the entire message row every animation frame.
  const player = useAudioPlayer(localUri, { updateInterval: 120 });
  const status = useAudioPlayerStatus(player);
  const fallbackDuration = attachmentDuration(attachment);
  const duration = positiveOr(status.duration, fallbackDuration);
  const currentTime = clamp(status.currentTime, 0, duration || Number.MAX_SAFE_INTEGER);
  const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
  const completed = useRef(false);
  const autoStarted = useRef(false);
  const play = useCallback(() => {
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).then(() => player.play()).catch(() => undefined);
  }, [player]);

  useEffect(() => {
    return registerVoiceController(streamId, attachment.id, {
      pause: () => player.pause(),
      play,
      setRate: (rate) => player.setPlaybackRate(rate),
    });
  }, [attachment.id, play, player, streamId]);

  useEffect(() => {
    if (!status.isLoaded || status.error || autoStarted.current) return;
    autoStarted.current = true;
    play();
  }, [play, status.error, status.isLoaded]);

  useEffect(() => {
    player.setPlaybackRate(speed);
  }, [player, speed]);

  useEffect(() => {
    if (!status.didJustFinish) {
      completed.current = false;
      return;
    }
    if (completed.current) return;
    completed.current = true;
    completeVoicePlayback(streamId, attachment.id);
  }, [attachment.id, status.didJustFinish, streamId]);

  const toggle = () => {
    if (status.playing) {
      pauseVoicePlayback(streamId, attachment.id);
      return;
    }
    if (status.didJustFinish || duration > 0 && currentTime >= duration - 0.05) {
      void player.seekTo(0).then(() => requestVoicePlayback(streamId, attachment.id));
      return;
    }
    requestVoicePlayback(streamId, attachment.id);
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
      failed={Boolean(status.error)}
      playing={status.playing}
      progress={progress}
      speed={speed}
      mine={mine}
      foreground={foreground}
      mutedForeground={mutedForeground}
      onSpeedChange={cycleVoicePlaybackSpeed}
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
  failed?: boolean;
  playing: boolean;
  progress: number;
  speed: VoicePlaybackSpeed;
  mine: boolean;
  foreground: string;
  mutedForeground: string;
  onToggle: () => void;
  onSpeedChange: () => void;
  onSeek?: (progress: number) => void;
}

function VoiceMessageFrame({ bars, currentSeconds, durationSeconds, loading, failed = false, playing, progress, speed, mine, foreground, mutedForeground, onToggle, onSpeedChange, onSeek }: VoiceMessageFrameProps) {
  const palette = usePalette();
  const { t } = useTranslation();
  const [waveformWidth, setWaveformWidth] = useState(DEFAULT_WAVEFORM_WIDTH);
  const playedBars = Math.round(clamp(progress, 0, 1) * bars.length);
  const controlColor = mine ? palette.pop : palette.accent;
  const controlForeground = mine ? palette.onPop : palette.onAccent;
  const idleWaveform = mine ? "rgba(255,255,255,0.72)" : palette.faintText;

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
        style={[styles.playButton, { backgroundColor: controlColor }]}
      >
        {loading
          ? <ActivityIndicator color={controlForeground} size="small" />
          : <AppIcon name={failed ? "refresh-outline" : playing ? "pause" : "play"} size={19} color={controlForeground} />}
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
          <View pointerEvents="none" style={styles.waveformCanvas}>
            {bars.map((height, index) => <View key={index} style={[styles.waveformBar, { height, backgroundColor: index < playedBars ? controlColor : idleWaveform }]} />)}
          </View>
        </Pressable>
        <View style={styles.meta}>
          <Text style={[styles.time, { color: mutedForeground }]}>{formatDuration(currentSeconds || durationSeconds)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("playbackSpeed")} onPress={onSpeedChange} hitSlop={7}>
            <Text style={[styles.speed, { color: mine ? foreground : palette.accent }]}>{speed}x</Text>
          </Pressable>
        </View>
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
  waveformCanvas: {
    width: "100%",
    height: VOICE_WAVEFORM_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
  },
  waveformBar: { width: 2, minHeight: 3, borderRadius: 1 },
  time: {
    minHeight: 14,
    marginTop: 1,
    fontSize: 11,
    lineHeight: 13,
    fontVariant: ["tabular-nums"],
  },
  meta: {
    minHeight: 15,
    marginTop: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  speed: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
});
