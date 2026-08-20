import { RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

import type { AppSettings, UploadQuality } from "@snezhok/contracts";

import { recordDiagnostic } from "../../diagnostics/diagnostics";
import { usePalette } from "../../hooks/usePalette";
import { useUiPreferences } from "../../hooks/useUiPreferences";
import { useTranslation } from "../../i18n";
import { recordingSourceForMicrophone, routeThroughEarpieceForMicrophone } from "../../lib/recordingWaveform";
import {
  claimAudioSession,
  ownsAudioSession,
  releaseAudioSession,
  runAudioSessionOperation,
  type AudioSessionLease,
} from "../../lib/audioSessionOwnership";
import { userFacingError } from "../../lib/userFacingError";
import {
  cycleVoicePlaybackSpeed,
  seekVoicePlayback,
  stopVoicePlayback,
  subscribeVoicePlayback,
  subscribeVoicePlaybackProgress,
  toggleCurrentVoicePlayback,
  voicePlaybackProgressSnapshot,
  voicePlaybackSnapshot,
} from "../../lib/voicePlaybackCoordinator";
import { voiceGestureDecision } from "../../lib/voiceRecordingGesture";
import { useAppStore } from "../../store/useAppStore";
import type { UploadInput } from "../../types";
import { AppIcon } from "../AppIcon";
import { useAppDialog } from "../AppDialogProvider";

export type VoiceRecordCommand = "idle" | "holding" | "locked" | "finish" | "cancel";

export function VoicePlaybackBanner({ streamId }: { streamId: string }) {
  const palette = usePalette();
  const { t, language } = useTranslation();
  const playback = useSyncExternalStore(subscribeVoicePlayback, voicePlaybackSnapshot, voicePlaybackSnapshot);
  const progress = useSyncExternalStore(subscribeVoicePlaybackProgress, voicePlaybackProgressSnapshot, voicePlaybackProgressSnapshot);
  const visible = playback.requestedKey?.startsWith(`${streamId}:`) && progress.key === playback.requestedKey;
  if (!visible) return null;
  const duration = Math.max(0, progress.durationSeconds);
  const ratio = duration > 0 ? Math.max(0, Math.min(1, progress.currentSeconds / duration)) : 0;
  return (
    <View style={[styles.banner, { backgroundColor: palette.elevated, borderColor: palette.outline }]}>
      <Pressable
        accessibilityLabel={progress.playing ? (language === "ru" ? "Пауза" : "Pause") : language === "ru" ? "Воспроизвести" : "Play"}
        accessibilityRole="button"
        onPress={toggleCurrentVoicePlayback}
        style={[styles.bannerPlay, { backgroundColor: palette.accent }]}
      >
        <AppIcon name={progress.playing ? "pause" : "play"} size={17} color={palette.onAccent} />
      </Pressable>
      <View style={styles.bannerCopy}>
        <Text numberOfLines={1} style={[styles.bannerTitle, { color: palette.text }]}>{t("voiceMessage")}</Text>
        <VoiceBannerSeek current={progress.currentSeconds} duration={duration} ratio={ratio} onSeek={seekVoicePlayback} />
      </View>
      <Pressable accessibilityLabel={t("playbackSpeed")} accessibilityRole="button" onPress={cycleVoicePlaybackSpeed} style={styles.bannerAction}>
        <Text style={[styles.bannerSpeed, { color: palette.accent }]}>{playback.speed}x</Text>
      </Pressable>
      <Pressable accessibilityLabel={t("close")} accessibilityRole="button" onPress={stopVoicePlayback} style={styles.bannerAction}>
        <AppIcon name="close" size={19} color={palette.secondaryText} />
      </Pressable>
    </View>
  );
}

function VoiceBannerSeek({ current, duration, ratio, onSeek }: { current: number; duration: number; ratio: number; onSeek: (seconds: number) => void }) {
  const palette = usePalette();
  const [width, setWidth] = useState(1);
  return (
    <View style={styles.bannerProgressRow}>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={`${formatDuration(current * 1_000)} / ${formatDuration(duration * 1_000)}`}
        onLayout={(event) => setWidth(Math.max(1, event.nativeEvent.layout.width))}
        onPress={(event) => onSeek(Math.max(0, Math.min(1, event.nativeEvent.locationX / width)) * duration)}
        style={[styles.bannerTrack, { backgroundColor: palette.border }]}
      >
        <View style={[styles.bannerFill, { width: `${ratio * 100}%`, backgroundColor: palette.accent }]} />
      </Pressable>
      <Text style={[styles.bannerTime, { color: palette.secondaryText }]}>{formatDuration(current * 1_000)}</Text>
    </View>
  );
}

interface RecorderProps {
  command: VoiceRecordCommand;
  quality: UploadQuality;
  microphoneMode: AppSettings["microphoneMode"];
  onRecordingChange: (value: boolean) => void;
  onMetering: (metering: number | undefined, durationMillis: number) => void;
  onTooShort: () => void;
  onCancel: () => void;
  onComplete: (input: UploadInput) => Promise<void>;
}

export function VoiceRecorderControl({ command, quality, microphoneMode, onRecordingChange, onMetering, onTooShort, onCancel, onComplete }: RecorderProps) {
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const recordingOptions = useMemo(() => ({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
    numberOfChannels: 1,
    android: { ...RecordingPresets.HIGH_QUALITY.android, audioSource: recordingSourceForMicrophone(microphoneMode) },
  }), [microphoneMode]);
  const recorder = useAudioRecorder(recordingOptions);
  const recorderState = useAudioRecorderState(recorder, 80);
  const [started, setStarted] = useState(false);
  const mounted = useRef(true);
  const finishing = useRef(false);
  const stopRequested = useRef(false);
  const duration = useRef(0);
  const audioLease = useRef<AudioSessionLease | null>(null);
  const recordingKey = useRef(`voice-recording:${Date.now()}:${Math.random().toString(36).slice(2)}`);
  const onMeteringRef = useRef(onMetering);
  const callbacks = useRef({ onCancel, onComplete, onRecordingChange, onTooShort });
  onMeteringRef.current = onMetering;
  callbacks.current = { onCancel, onComplete, onRecordingChange, onTooShort };
  duration.current = recorderState.durationMillis;

  useEffect(() => {
    if (started && recorderState.isRecording) onMeteringRef.current(recorderState.metering, recorderState.durationMillis);
  }, [recorderState.durationMillis, recorderState.isRecording, recorderState.metering, started]);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const lease = claimAudioSession("voice-recording", recordingKey.current, () => {
          if (finishing.current) return;
          finishing.current = true;
          stopRequested.current = true;
          callbacks.current.onRecordingChange(false);
          callbacks.current.onCancel();
          if (recorder.isRecording) return recorder.stop().catch(() => undefined);
        });
        if (!lease) throw new Error("AUDIO_SESSION_BUSY");
        audioLease.current = lease;
        const shouldRouteThroughEarpiece = routeThroughEarpieceForMicrophone(microphoneMode);
        await runAudioSessionOperation(lease, () => setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, ...(shouldRouteThroughEarpiece !== undefined ? { shouldRouteThroughEarpiece } : {}) }));
        if (!ownsAudioSession(lease)) return;
        try {
          await recorder.prepareToRecordAsync();
        } catch (error) {
          if (microphoneMode !== "speakerphone") throw error;
          recordDiagnostic("warn", "media", "Voice recorder source fallback", { source: "voice_communication" });
          await recorder.prepareToRecordAsync({ ...recordingOptions, android: { ...recordingOptions.android, audioSource: "default" } });
        }
        if (!mounted.current) {
          await releaseAudioSession(lease, () => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })).catch(() => false);
          return;
        }
        recorder.record();
        if (mounted.current) {
          setStarted(true);
          callbacks.current.onRecordingChange(true);
        }
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      } catch (error) {
        const lease = audioLease.current;
        audioLease.current = null;
        await releaseAudioSession(lease, () => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })).catch(() => false);
        const busy = error instanceof Error && error.message === "AUDIO_SESSION_BUSY";
        showDialog(busy ? t("callUnavailable") : t("microphoneRequired"), busy ? t("audioSessionBusy") : userFacingError(error, t));
        callbacks.current.onCancel();
      }
    })();
    return () => {
      mounted.current = false;
      if (!stopRequested.current && recorder.isRecording) {
        stopRequested.current = true;
        void recorder.stop().catch(() => undefined);
      }
      const lease = audioLease.current;
      audioLease.current = null;
      void releaseAudioSession(lease, () => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })).catch(() => false);
    };
  }, [microphoneMode, recorder, recordingOptions, showDialog, t]);

  const finish = useCallback(async (cancelled: boolean) => {
    if (finishing.current) return;
    finishing.current = true;
    stopRequested.current = true;
    const recordedDuration = duration.current;
    try {
      await recorder.stop();
      const lease = audioLease.current;
      audioLease.current = null;
      await releaseAudioSession(lease, () => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }));
      callbacks.current.onRecordingChange(false);
      if (cancelled) return callbacks.current.onCancel();
      if (recordedDuration < 450) {
        callbacks.current.onTooShort();
        return callbacks.current.onCancel();
      }
      if (!recorder.uri) throw new Error(t("tryAgain"));
      await callbacks.current.onComplete({ uri: recorder.uri, filename: `voice-${Date.now()}.m4a`, mimeType: "audio/mp4", kind: "audio", quality, purpose: "voice" });
    } catch (error) {
      showDialog(t("uploadFailed"), userFacingError(error, t));
      callbacks.current.onCancel();
    }
  }, [quality, recorder, showDialog, t]);

  useEffect(() => {
    if (!started) return;
    if (command === "cancel") void finish(true);
    else if (command === "finish") void finish(false);
  }, [command, finish, started]);
  return null;
}

interface GestureProps {
  command: VoiceRecordCommand;
  disabled: boolean;
  onStart: () => void;
  onLock: () => void;
  onCancel: () => void;
  onFinish: () => void;
}

export function VoiceGestureButton({ command, disabled, onStart, onLock, onCancel, onFinish }: GestureProps) {
  const palette = usePalette();
  const { t } = useTranslation();
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const callbacks = useRef({ onStart, onLock, onCancel, onFinish });
  const state = useRef({ command, disabled });
  const resolved = useRef<"lock" | "cancel" | null>(null);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  callbacks.current = { onStart, onLock, onCancel, onFinish };
  state.current = { command, disabled };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !state.current.disabled && state.current.command === "idle",
    onMoveShouldSetPanResponder: () => !state.current.disabled && state.current.command === "idle",
    onPanResponderGrant: () => {
      resolved.current = null;
      translateX.value = 0;
      translateY.value = 0;
      scale.value = withTiming(1.12, { duration: reducedMotion ? 0 : 90 });
      callbacks.current.onStart();
    },
    onPanResponderMove: (_event, gesture) => {
      if (resolved.current) return;
      translateX.value = Math.max(-54, Math.min(0, gesture.dx * 0.38));
      translateY.value = Math.max(-42, Math.min(0, gesture.dy * 0.32));
      const decision = voiceGestureDecision(gesture.dx, gesture.dy);
      if (decision === "cancel") {
        resolved.current = "cancel";
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
        callbacks.current.onCancel();
      } else if (decision === "lock") {
        resolved.current = "lock";
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
        callbacks.current.onLock();
      }
    },
    onPanResponderRelease: () => {
      translateX.value = withTiming(0, { duration: reducedMotion ? 0 : 140 });
      translateY.value = withTiming(0, { duration: reducedMotion ? 0 : 140 });
      scale.value = withTiming(1, { duration: reducedMotion ? 0 : 120 });
      if (!resolved.current) callbacks.current.onFinish();
    },
    onPanResponderTerminate: () => {
      translateX.value = 0;
      translateY.value = 0;
      scale.value = 1;
      if (!resolved.current) callbacks.current.onCancel();
    },
  }), [reducedMotion, scale, translateX, translateY]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }] }));
  const locked = command === "locked";
  const active = command !== "idle";
  const activate = () => {
    if (locked || command === "holding") callbacks.current.onFinish();
    else if (command === "idle") { callbacks.current.onStart(); callbacks.current.onLock(); }
  };
  return (
    <Animated.View
      {...responder.panHandlers}
      accessible
      accessibilityActions={[{ name: "activate" }, { name: "escape" }]}
      accessibilityHint={locked ? t("recordingLocked") : t("releaseToSend")}
      accessibilityLabel={active ? t("stopRecording") : t("recordVoice")}
      accessibilityRole="button"
      onAccessibilityAction={(event) => (event.nativeEvent.actionName === "escape" ? callbacks.current.onCancel() : activate())}
      style={[styles.send, { backgroundColor: active ? palette.danger : palette.accent, borderColor: palette.outline, opacity: disabled ? 0.45 : 1 }, animated]}
    >
      <Pressable disabled={disabled || !locked} onPress={onFinish} style={styles.voiceButtonFill}>
        <AppIcon name={locked ? "arrow-up" : "mic"} size={locked ? 21 : 20} color={active ? palette.onDanger : palette.onAccent} />
      </Pressable>
    </Animated.View>
  );
}

export function RecordingStatus({ levels, durationMillis, locked }: { levels: number[]; durationMillis: number; locked: boolean }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const { t } = useTranslation();
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const pulse = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(pulse);
    pulse.value = reducedMotion ? 1 : withRepeat(withTiming(0.28, { duration: 520, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse, reducedMotion]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View style={[styles.recording, { backgroundColor: palette.surface }]}>
      <Animated.View style={[styles.recordDot, { backgroundColor: palette.danger }, pulseStyle]} />
      <Text style={[styles.recordingTime, { color: palette.text, fontSize: ui.font(13) }]}>{formatDuration(durationMillis)}</Text>
      <View style={styles.liveWaveform} accessible accessibilityLabel={t("liveMicrophoneLevel")}>
        {levels.map((level, index) => <View key={index} style={[styles.liveWaveformBar, { backgroundColor: palette.accent, height: 3 + level * 21 }]} />)}
      </View>
      <Text numberOfLines={2} style={[styles.recordingHint, { color: locked ? palette.accent : palette.secondaryText, fontSize: ui.font(10.5) }]}>
        {locked ? t("recordingLocked") : `${t("slideToCancel")} · ${t("slideToLock")}`}
      </Text>
    </View>
  );
}

function formatDuration(durationMillis: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMillis / 1_000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  banner: { minHeight: 50, marginHorizontal: 10, marginTop: 4, paddingHorizontal: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 15, flexDirection: "row", alignItems: "center", gap: 7 },
  bannerPlay: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  bannerCopy: { flex: 1, minWidth: 0, paddingVertical: 5 },
  bannerTitle: { fontSize: 12, lineHeight: 15, fontWeight: "800" },
  bannerProgressRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 3 },
  bannerTrack: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden" },
  bannerFill: { height: 4, borderRadius: 2 },
  bannerTime: { width: 31, fontSize: 9.5, fontVariant: ["tabular-nums"] },
  bannerAction: { minWidth: 34, height: 38, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  bannerSpeed: { fontSize: 12, fontWeight: "900", fontVariant: ["tabular-nums"] },
  recording: { minHeight: 42, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 },
  recordDot: { width: 9, height: 9, borderRadius: 5 },
  recordingTime: { width: 38, fontVariant: ["tabular-nums"], fontWeight: "700" },
  recordingHint: { maxWidth: 145, lineHeight: 13, fontWeight: "700" },
  liveWaveform: { flex: 1, minWidth: 48, height: 28, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2, overflow: "hidden" },
  liveWaveformBar: { width: 2, minHeight: 3, borderRadius: 2 },
  send: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 1 },
  voiceButtonFill: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", borderRadius: 12 },
});
