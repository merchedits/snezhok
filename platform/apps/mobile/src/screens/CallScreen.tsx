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
import { ActivityIndicator, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConnectionQuality, ConnectionState, RoomEvent, Track } from "livekit-client";

import { Avatar } from "../components/Avatar";
import { useAppDialog } from "../components/AppDialogProvider";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { api } from "../lib/api";
import { availableAudioRoutes, nextAudioRoute, preferredAudioOutputs, type CallAudioRoute } from "../lib/callAudioRoute";
import { classifyCallFailure } from "../lib/callDiagnostics";
import { callMediaProfile } from "../lib/callQuality";
import { recordDiagnostic } from "../diagnostics/diagnostics";
import { userFacingError } from "../lib/userFacingError";
import { useAppStore } from "../store/useAppStore";
import type { CallJoinResponse, RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Call">;

export function CallScreen({ navigation, route }: Props) {
  const palette = usePalette();
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const [credentials, setCredentials] = useState<CallJoinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioRoutes, setAudioRoutes] = useState<Exclude<CallAudioRoute, "auto">[]>([]);
  const [audioRoute, setAudioRoute] = useState<Exclude<CallAudioRoute, "auto"> | null>(null);
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
          if (active) setError(t("microphonePermissionDenied"));
          return;
        }
        const preferred = preferredAudioOutputs(settings.callAudioRoute, settings.microphoneMode);
        await AudioSession.configureAudio({ android: { preferredOutputList: [...preferred], audioTypeOptions: { manageAudioFocus: true, audioMode: "inCommunication", audioFocusMode: "gain", audioStreamType: "voiceCall", audioAttributesUsageType: "voiceCommunication", audioAttributesContentType: "speech", forceHandleAudioRouting: true } } });
        await AudioSession.startAudioSession();
        audioStarted = true;
        const available = availableAudioRoutes(await AudioSession.getAudioOutputs());
        const selected = preferred.find((candidate) => available.includes(candidate)) ?? available[0] ?? null;
        if (selected) await AudioSession.selectAudioOutput(selected);
        if (active) { setAudioRoutes(available); setAudioRoute(selected); }
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
        recordDiagnostic("error", "call", "Call setup failed", { failure: classifyCallFailure(reason), error: reason, streamId: route.params.streamId });
        if (active) setError(userFacingError(reason, t));
      }
    })();
    return () => {
      active = false;
      if (audioStarted) void AudioSession.stopAudioSession().catch(() => undefined);
    };
  }, [route.params.streamId, settings.callAudioRoute, settings.microphoneMode, t]);

  useEffect(() => () => endOwnedCall(), [endOwnedCall]);

  if (error) {
    return <SafeAreaView style={[styles.loading, { backgroundColor: palette.background }]}><AppIcon name="warning-outline" size={42} color={palette.danger} /><Text style={[styles.errorTitle, { color: palette.text }]}>{t("callUnavailable")}</Text><Text style={[styles.errorText, { color: palette.secondaryText }]}>{error}</Text><Pressable onPress={navigation.goBack} style={[styles.retry, { backgroundColor: palette.accent }]}><Text style={styles.retryText}>{t("goBack")}</Text></Pressable></SafeAreaView>;
  }
  if (!credentials) return <SafeAreaView style={[styles.loading, { backgroundColor: palette.background }]}><ActivityIndicator size="large" color={palette.accent} /><Text style={[styles.connecting, { color: palette.secondaryText }]}>{t("joiningCall", { title: route.params.title })}</Text></SafeAreaView>;

  const profile = callMediaProfile(settings.callQuality, settings.screenShareQuality);
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
          simulcast: profile.simulcast,
          videoCodec: "vp8",
          audioPreset: { maxBitrate: profile.audioBitrate },
          videoEncoding: { maxBitrate: profile.camera.maxBitrate, maxFramerate: profile.camera.frameRate },
          screenShareEncoding: { maxBitrate: profile.screen.maxBitrate, maxFramerate: profile.screen.frameRate },
        },
      }}
      connectOptions={{ maxRetries: 5, websocketTimeout: 15_000, peerConnectionTimeout: 20_000, rtcConfig: { iceTransportPolicy: "all" } }}
      onError={(reason) => { recordDiagnostic("error", "call", "LiveKit connection failed", { failure: classifyCallFailure(reason), error: reason, callId: credentials.callId }); setError(reason.message); }}
      onMediaDeviceFailure={(failure) => recordDiagnostic("error", "call", "LiveKit media device failure", { failure: classifyCallFailure(failure), mediaFailure: failure ?? "unknown", callId: credentials.callId })}
    >
      <CallRoom title={route.params.title} audioRoutes={audioRoutes} initialAudioRoute={audioRoute} profile={profile} onLeave={() => { endOwnedCall(); navigation.goBack(); }} />
    </LiveKitRoom>
  );
}

function CallRoom({ title, audioRoutes, initialAudioRoute, profile, onLeave }: { title: string; audioRoutes: Exclude<CallAudioRoute, "auto">[]; initialAudioRoute: Exclude<CallAudioRoute, "auto"> | null; profile: ReturnType<typeof callMediaProfile>; onLeave: () => void }) {
  const palette = usePalette();
  const showDialog = useAppDialog();
  const { t } = useTranslation();
  const room = useRoomContext();
  const connection = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const videoTracks = useTracks([Track.Source.ScreenShare, Track.Source.Camera], { onlySubscribed: false });
  const [audioRoute, setAudioRoute] = useState(initialAudioRoute);
  const [availableRoutes, setAvailableRoutes] = useState(audioRoutes);
  const [quality, setQuality] = useState<ConnectionQuality>(ConnectionQuality.Unknown);
  const [reconnects, setReconnects] = useState(0);

  const toggle = async (action: () => Promise<unknown>, failure: string) => action().catch((error: unknown) => showDialog(failure, userFacingError(error, t)));
  const leave = () => { room.disconnect(); onLeave(); };
  const cycleAudioRoute = async () => {
    const currentRoutes = availableAudioRoutes(await AudioSession.getAudioOutputs());
    setAvailableRoutes(currentRoutes);
    const next = nextAudioRoute(audioRoute ?? "", currentRoutes);
    if (!next) return;
    await AudioSession.selectAudioOutput(next);
    setAudioRoute(next);
  };

  useEffect(() => {
    const onReconnecting = () => { setReconnects((count) => count + 1); recordDiagnostic("warn", "call", "LiveKit reconnecting", { connection: room.state }); };
    const onReconnected = () => recordDiagnostic("info", "call", "LiveKit reconnected", { connection: room.state });
    const onDisconnected = (reason?: unknown) => recordDiagnostic("warn", "call", "LiveKit disconnected", { reason: String(reason ?? "unknown"), failure: classifyCallFailure(reason) });
    const onQuality = (next: ConnectionQuality, participant: { isLocal?: boolean }) => { if (participant.isLocal) { setQuality(next); recordDiagnostic(next === ConnectionQuality.Poor || next === ConnectionQuality.Lost ? "warn" : "debug", "call", "LiveKit connection quality changed", { quality: next }); } };
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    return () => { room.off(RoomEvent.Reconnecting, onReconnecting); room.off(RoomEvent.Reconnected, onReconnected); room.off(RoomEvent.Disconnected, onDisconnected); room.off(RoomEvent.ConnectionQualityChanged, onQuality); };
  }, [room]);

  const screenTrack = videoTracks.find((track) => track.source === Track.Source.ScreenShare);
  const cameraTracks = videoTracks.filter((track) => track.source === Track.Source.Camera);
  const connected = connection === ConnectionState.Connected;

  return (
    <SafeAreaView style={[styles.call, { backgroundColor: palette.background }]}> 
      <View style={styles.callHeader}>
        <View><Text style={[styles.callTitle, { color: palette.text }]}>{title}</Text><Text style={[styles.callState, { color: connected ? palette.success : palette.warning }]}>{connected ? t("connected", { count: participants.length }) : connectionStateLabel(connection, t)}</Text></View>
        <Pressable onPress={leave} style={styles.headerClose}><AppIcon name="chevron-down" size={28} color={palette.text} /></Pressable>
      </View>

      {screenTrack ? <View style={[styles.screenStage, { borderColor: palette.border }]}><VideoTrack trackRef={screenTrack} style={styles.screenVideo} objectFit="contain" /><View style={styles.screenLabel}><Text style={styles.screenLabelText}>{screenTrack.participant.name || screenTrack.participant.identity} · {t("screen")}</Text></View></View> : null}

      <ScrollView contentContainerStyle={[styles.participants, screenTrack && styles.participantsWithScreen]}>
        {cameraTracks.length > 0 ? <View style={styles.cameraGrid}>{cameraTracks.map((track) => <View key={`${track.participant.identity}-${track.source}`} style={[styles.cameraTile, { borderColor: palette.border }]}><VideoTrack trackRef={track} style={styles.cameraVideo} objectFit="cover" mirror={track.participant.isLocal} /><Text style={styles.cameraName}>{track.participant.name || track.participant.identity}</Text></View>)}</View> : null}
        <View style={styles.voiceGrid}>
          {participants.map((participant) => {
            const meta = participantMetadata(participant.metadata);
            return <View key={participant.identity} style={[styles.person, { backgroundColor: palette.surface, borderColor: participant.isSpeaking ? palette.success : palette.border }]}><Avatar uri={meta.avatarUrl ?? null} label={participant.name || participant.identity} color={meta.avatarColor} size={60} /><Text numberOfLines={1} style={[styles.personName, { color: palette.text }]}>{participant.isLocal ? t("you") : participant.name || participant.identity}</Text><AppIcon name={participant.isMicrophoneEnabled ? "mic" : "mic-off"} size={15} color={participant.isMicrophoneEnabled ? palette.secondaryText : palette.danger} /></View>;
          })}
        </View>
      </ScrollView>

      <View style={styles.controls}>
        <CallButton icon={isMicrophoneEnabled ? "mic" : "mic-off"} label={isMicrophoneEnabled ? t("muteCall") : t("unmuteCall")} active={!isMicrophoneEnabled} onPress={() => void toggle(async () => { if (!isMicrophoneEnabled && !(await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO))) throw new Error(t("microphonePermissionDenied")); return localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled); }, t("microphoneUnavailable"))} />
        <CallButton icon={isCameraEnabled ? "videocam" : "videocam-off"} label={t("camera")} active={isCameraEnabled} onPress={() => void toggle(async () => { if (!isCameraEnabled && !(await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA))) throw new Error(t("cameraPermissionDenied")); return localParticipant.setCameraEnabled(!isCameraEnabled, { resolution: { width: profile.camera.width, height: profile.camera.height, frameRate: profile.camera.frameRate }, frameRate: profile.camera.frameRate }, { videoEncoding: { maxBitrate: profile.camera.maxBitrate, maxFramerate: profile.camera.frameRate }, simulcast: profile.simulcast }); }, t("cameraUnavailable"))} />
        <CallButton icon="phone-portrait-outline" label={t("shareScreen")} active={isScreenShareEnabled} onPress={() => void toggle(() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled, { resolution: { width: profile.screen.width, height: profile.screen.height, frameRate: profile.screen.frameRate } }, { screenShareEncoding: { maxBitrate: profile.screen.maxBitrate, maxFramerate: profile.screen.frameRate }, simulcast: profile.simulcast }), t("screenShareUnavailable"))} />
        <CallButton icon={audioRoute === "earpiece" ? "ear-outline" : "volume-high"} label={audioRoute ? audioRouteLabel(audioRoute, t) : `${t("audio")} (${availableRoutes.length})`} active={audioRoute === "speaker"} onPress={() => void toggle(cycleAudioRoute, t("callUnavailable"))} />
        <CallButton icon="ellipsis-horizontal" label={t("more")} onPress={() => showDialog(t("callSettings"), `${t("callSettingsDescription")}\n\n${t("callQualityStatus", { quality: connectionQualityLabel(quality, t) })}\n${t("callReconnectsStatus", { count: reconnects })}\n${t("callAudioStatus", { route: audioRoute ? audioRouteLabel(audioRoute, t) : t("callRouteAutomatic") })}`)} />
        <CallButton icon="call" label={t("leaveCall")} danger onPress={leave} />
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

type Translate = ReturnType<typeof useTranslation>["t"];

function connectionStateLabel(state: ConnectionState, t: Translate): string {
  if (state === ConnectionState.Reconnecting) return t("callReconnecting");
  if (state === ConnectionState.Disconnected) return t("callDisconnected");
  return t("callConnecting");
}

function connectionQualityLabel(quality: ConnectionQuality, t: Translate): string {
  if (quality === ConnectionQuality.Excellent) return t("connectionExcellent");
  if (quality === ConnectionQuality.Good) return t("connectionGood");
  if (quality === ConnectionQuality.Poor) return t("connectionPoor");
  if (quality === ConnectionQuality.Lost) return t("connectionLost");
  return t("connectionUnknown");
}

function audioRouteLabel(route: Exclude<CallAudioRoute, "auto">, t: Translate): string {
  if (route === "earpiece") return t("callRouteEarpiece");
  if (route === "speaker") return t("callRouteSpeaker");
  if (route === "headset") return t("callRouteHeadset");
  return t("callRouteBluetooth");
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
