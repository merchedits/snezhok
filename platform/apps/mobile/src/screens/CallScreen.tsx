import { AppIcon, type AppIconName } from "../components/AppIcon";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConnectionState, Track, VideoPresets } from "livekit-client";

import { Avatar } from "../components/Avatar";
import { usePalette } from "../hooks/usePalette";
import { api } from "../lib/api";
import { useAppStore } from "../store/useAppStore";
import type { CallJoinResponse, RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Call">;

export function CallScreen({ navigation, route }: Props) {
  const palette = usePalette();
  const settings = useAppStore((state) => state.settings);
  const [credentials, setCredentials] = useState<CallJoinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const credentialsRef = useRef<CallJoinResponse | null>(null);
  const endRequested = useRef(false);

  const endOwnedCall = useCallback(() => {
    const current = credentialsRef.current;
    if (!current?.canEnd || endRequested.current) return;
    endRequested.current = true;
    void api.endCall(current.callId).catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    let audioStarted = false;
    void (async () => {
      try {
        if (!(await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO))) {
          throw new Error("Microphone permission is required to join a call");
        }
        await AudioSession.configureAudio({ android: { audioTypeOptions: { manageAudioFocus: true, audioMode: "inCommunication", audioFocusMode: "gain", audioStreamType: "voiceCall", audioAttributesUsageType: "voiceCommunication", audioAttributesContentType: "speech" } } });
        await AudioSession.startAudioSession();
        audioStarted = true;
        const result = await api.joinCall(route.params.streamId);
        if (!active) {
          if (result.canEnd) void api.endCall(result.callId).catch(() => undefined);
          return;
        }
        credentialsRef.current = result;
        setCredentials(result);
      } catch (reason: unknown) {
        if (audioStarted) {
          audioStarted = false;
          await AudioSession.stopAudioSession().catch(() => undefined);
        }
        if (active) setError(reason instanceof Error ? reason.message : "Could not join this call");
      }
    })();
    return () => {
      active = false;
      if (audioStarted) void AudioSession.stopAudioSession().catch(() => undefined);
    };
  }, [route.params.streamId]);

  useEffect(() => () => endOwnedCall(), [endOwnedCall]);

  if (error) {
    return <SafeAreaView style={[styles.loading, { backgroundColor: palette.background }]}><AppIcon name="warning-outline" size={42} color={palette.danger} /><Text style={[styles.errorTitle, { color: palette.text }]}>Call unavailable</Text><Text style={[styles.errorText, { color: palette.secondaryText }]}>{error}</Text><Pressable onPress={navigation.goBack} style={[styles.retry, { backgroundColor: palette.accent }]}><Text style={styles.retryText}>Go back</Text></Pressable></SafeAreaView>;
  }
  if (!credentials) return <SafeAreaView style={[styles.loading, { backgroundColor: palette.background }]}><ActivityIndicator size="large" color={palette.accent} /><Text style={[styles.connecting, { color: palette.secondaryText }]}>Joining {route.params.title}…</Text></SafeAreaView>;

  return (
    <LiveKitRoom
      serverUrl={credentials.url}
      token={credentials.token}
      connect
      audio={{
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression !== "off",
        autoGainControl: settings.autoGainControl,
      }}
      video={false}
      options={{
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          simulcast: true,
          videoCodec: "vp8",
          screenShareEncoding: VideoPresets.h720.encoding,
          screenShareSimulcastLayers: [VideoPresets.h360],
        },
      }}
      onError={(reason) => setError(reason.message)}
    >
      <CallRoom title={route.params.title} onLeave={() => { endOwnedCall(); navigation.goBack(); }} />
    </LiveKitRoom>
  );
}

function CallRoom({ title, onLeave }: { title: string; onLeave: () => void }) {
  const palette = usePalette();
  const room = useRoomContext();
  const connection = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const videoTracks = useTracks([Track.Source.ScreenShare, Track.Source.Camera], { onlySubscribed: false });
  const [speaker, setSpeaker] = useState(true);

  const toggle = async (action: () => Promise<unknown>, failure: string) => action().catch((error: unknown) => Alert.alert(failure, error instanceof Error ? error.message : "Try again."));
  const leave = () => { room.disconnect(); onLeave(); };
  const toggleSpeaker = async () => {
    const next = !speaker;
    await AudioSession.selectAudioOutput(next ? "speaker" : "earpiece").catch(() => undefined);
    setSpeaker(next);
  };

  const screenTrack = videoTracks.find((track) => track.source === Track.Source.ScreenShare);
  const cameraTracks = videoTracks.filter((track) => track.source === Track.Source.Camera);
  const connected = connection === ConnectionState.Connected;

  return (
    <SafeAreaView style={[styles.call, { backgroundColor: palette.background }]}> 
      <View style={styles.callHeader}>
        <View><Text style={[styles.callTitle, { color: palette.text }]}>{title}</Text><Text style={[styles.callState, { color: connected ? palette.success : palette.warning }]}>{connected ? `${participants.length} connected` : connection}</Text></View>
        <Pressable onPress={leave} style={styles.headerClose}><AppIcon name="chevron-down" size={28} color={palette.text} /></Pressable>
      </View>

      {screenTrack ? <View style={[styles.screenStage, { borderColor: palette.border }]}><VideoTrack trackRef={screenTrack} style={styles.screenVideo} objectFit="contain" /><View style={styles.screenLabel}><Text style={styles.screenLabelText}>{screenTrack.participant.name || screenTrack.participant.identity} · screen</Text></View></View> : null}

      <ScrollView contentContainerStyle={[styles.participants, screenTrack && styles.participantsWithScreen]}>
        {cameraTracks.length > 0 ? <View style={styles.cameraGrid}>{cameraTracks.map((track) => <View key={`${track.participant.identity}-${track.source}`} style={[styles.cameraTile, { borderColor: palette.border }]}><VideoTrack trackRef={track} style={styles.cameraVideo} objectFit="cover" mirror={track.participant.isLocal} /><Text style={styles.cameraName}>{track.participant.name || track.participant.identity}</Text></View>)}</View> : null}
        <View style={styles.voiceGrid}>
          {participants.map((participant) => {
            const meta = participantMetadata(participant.metadata);
            return <View key={participant.identity} style={[styles.person, { backgroundColor: palette.surface, borderColor: participant.isSpeaking ? palette.success : palette.border }]}><Avatar uri={meta.avatarUrl ?? null} label={participant.name || participant.identity} color={meta.avatarColor} size={60} /><Text numberOfLines={1} style={[styles.personName, { color: palette.text }]}>{participant.isLocal ? "You" : participant.name || participant.identity}</Text><AppIcon name={participant.isMicrophoneEnabled ? "mic" : "mic-off"} size={15} color={participant.isMicrophoneEnabled ? palette.secondaryText : palette.danger} /></View>;
          })}
        </View>
      </ScrollView>

      <View style={styles.controls}>
        <CallButton icon={isMicrophoneEnabled ? "mic" : "mic-off"} label={isMicrophoneEnabled ? "Mute" : "Unmute"} active={!isMicrophoneEnabled} onPress={() => void toggle(async () => { if (!isMicrophoneEnabled && !(await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO))) throw new Error("Microphone permission denied"); return localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled); }, "Microphone unavailable")} />
        <CallButton icon={isCameraEnabled ? "videocam" : "videocam-off"} label="Camera" active={isCameraEnabled} onPress={() => void toggle(async () => { if (!isCameraEnabled && !(await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA))) throw new Error("Camera permission denied"); return localParticipant.setCameraEnabled(!isCameraEnabled); }, "Camera unavailable")} />
        <CallButton icon="phone-portrait-outline" label="Share" active={isScreenShareEnabled} onPress={() => void toggle(() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled), "Screen share unavailable")} />
        <CallButton icon={speaker ? "volume-high" : "ear-outline"} label={speaker ? "Speaker" : "Earpiece"} active={speaker} onPress={() => void toggleSpeaker()} />
        <CallButton icon="ellipsis-horizontal" label="More" onPress={() => Alert.alert("Call settings", "Audio processing follows Voice and video settings. Media quality adapts to the connection.")} />
        <CallButton icon="call" label="Leave" danger onPress={leave} />
      </View>
    </SafeAreaView>
  );
}

function participantMetadata(value: string | undefined): { avatarUrl?: string; avatarColor?: string } {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.avatarUrl === "string" ? { avatarUrl: record.avatarUrl } : {}),
      ...(typeof record.avatarColor === "string" ? { avatarColor: record.avatarColor } : {}),
    };
  } catch {
    return {};
  }
}

async function requestAndroidPermission(permission: typeof PermissionsAndroid.PERMISSIONS.CAMERA | typeof PermissionsAndroid.PERMISSIONS.RECORD_AUDIO): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (await PermissionsAndroid.check(permission)) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

function CallButton({ icon, label, active = false, danger = false, onPress }: { icon: AppIconName; label: string; active?: boolean; danger?: boolean; onPress: () => void }) {
  const palette = usePalette();
  const background = danger ? palette.danger : active ? palette.accent : palette.elevated;
  return <Pressable onPress={onPress} accessibilityLabel={label} style={styles.control}><View style={[styles.controlCircle, { backgroundColor: background }]}><AppIcon name={icon} size={22} color={danger || active ? "white" : palette.text} /></View><Text style={[styles.controlLabel, { color: palette.secondaryText }]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  connecting: { fontSize: 14, marginTop: 14 },
  errorTitle: { fontSize: 20, fontWeight: "800", marginTop: 14 },
  errorText: { fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 7 },
  retry: { height: 44, borderRadius: 11, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", marginTop: 22 },
  retryText: { color: "white", fontWeight: "700" },
  call: { flex: 1 },
  callHeader: { minHeight: 62, flexDirection: "row", alignItems: "center", paddingHorizontal: 18 },
  callTitle: { fontSize: 19, fontWeight: "800" },
  callState: { fontSize: 12, marginTop: 3, textTransform: "capitalize" },
  headerClose: { marginLeft: "auto", width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  screenStage: { height: "48%", marginHorizontal: 10, borderWidth: 1, borderRadius: 14, overflow: "hidden", backgroundColor: "#050505" },
  screenVideo: { width: "100%", height: "100%" },
  screenLabel: { position: "absolute", left: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.68)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  screenLabelText: { color: "white", fontSize: 11, fontWeight: "600" },
  participants: { flexGrow: 1, justifyContent: "center", padding: 14 },
  participantsWithScreen: { justifyContent: "flex-start" },
  cameraGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  cameraTile: { width: "48%", aspectRatio: 0.9, borderWidth: 1, borderRadius: 12, overflow: "hidden", backgroundColor: "black" },
  cameraVideo: { width: "100%", height: "100%" },
  cameraName: { position: "absolute", left: 7, bottom: 7, color: "white", fontSize: 11, fontWeight: "600", textShadowColor: "black", textShadowRadius: 4 },
  voiceGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 },
  person: { width: 112, minHeight: 126, borderWidth: 2, borderRadius: 14, alignItems: "center", justifyContent: "center", padding: 10 },
  personName: { width: "100%", textAlign: "center", fontSize: 13, fontWeight: "600", marginTop: 7, marginBottom: 4 },
  controls: { minHeight: 92, flexDirection: "row", justifyContent: "space-evenly", alignItems: "flex-start", paddingHorizontal: 6, paddingTop: 8 },
  control: { width: 57, alignItems: "center" },
  controlCircle: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  controlLabel: { fontSize: 10, marginTop: 5 },
});
