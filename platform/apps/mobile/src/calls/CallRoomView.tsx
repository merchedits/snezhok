import {
  AudioSession,
  VideoTrack,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTrackVolume,
  useTracks,
} from "@livekit/react-native";
import { useState } from "react";
import { PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConnectionState, type Participant, type RemoteParticipant, Track } from "livekit-client";

import { AppIcon, type AppIconName } from "../components/AppIcon";
import { Avatar } from "../components/Avatar";
import { useAppDialog } from "../components/AppDialogProvider";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { nextAudioRoute } from "../lib/callAudioRoute";
import { callMediaProfile } from "../lib/callQuality";
import { userFacingError } from "../lib/userFacingError";
import { useAppStore } from "../store/useAppStore";
import { canPublishSource, useCallSession } from "./CallSessionProvider";
import { callCopy } from "./callStrings";
import { playCallOutputTest, updateCallForegroundService } from "./callForegroundService";

export function CallRoomView({ onMinimize }: { onMinimize: () => void }) {
  const palette = usePalette();
  const showDialog = useAppDialog();
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const copy = callCopy(settings.language);
  const { session, leaveCall, toggleMicrophone, setAudioRoute } = useCallSession();
  const room = useRoomContext();
  const connection = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const videoTracks = useTracks([Track.Source.ScreenShare, Track.Source.Camera], { onlySubscribed: false });
  const microphoneTracks = useTracks([Track.Source.Microphone], { onlySubscribed: false });
  const localMicrophoneTrack = microphoneTracks.find((track) => track.participant.isLocal);
  const microphoneLevel = useTrackVolume(localMicrophoneTrack);
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({});

  if (!session) return null;
  const profile = callMediaProfile(settings.callQuality, settings.screenShareQuality);
  const screenTrack = videoTracks.find((track) => track.source === Track.Source.ScreenShare);
  const cameraTracks = videoTracks.filter((track) => track.source === Track.Source.Camera);
  const connected = connection === ConnectionState.Connected;

  const run = (action: () => Promise<unknown>, title: string) => {
    void action().catch((error: unknown) => showDialog(title, userFacingError(error, t)));
  };

  const toggleCamera = async () => {
    if (!isCameraEnabled) {
      if (!canPublishSource(room, Track.Source.Camera)) { showDialog(t("cameraUnavailable"), copy.permissionRestricted); return; }
      if (!(await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA))) throw new Error(t("cameraPermissionDenied"));
    }
    const nextEnabled = !isCameraEnabled;
    await localParticipant.setCameraEnabled(nextEnabled, { resolution: { width: profile.camera.width, height: profile.camera.height, frameRate: profile.camera.frameRate }, frameRate: profile.camera.frameRate }, { videoEncoding: { maxBitrate: profile.camera.maxBitrate, maxFramerate: profile.camera.frameRate }, simulcast: profile.simulcast });
    if (!updateCallForegroundService(session.title, copy.active, nextEnabled)) {
      await localParticipant.setCameraEnabled(isCameraEnabled).catch(() => undefined);
      throw new Error("CALL_FOREGROUND_SERVICE_UPDATE_FAILED");
    }
  };

  const toggleScreen = () => {
    if (isScreenShareEnabled) {
      run(() => localParticipant.setScreenShareEnabled(false), t("screenShareUnavailable"));
      return;
    }
    if (!canPublishSource(room, Track.Source.ScreenShare)) { showDialog(t("screenShareUnavailable"), copy.permissionRestricted); return; }
    showDialog(copy.shareTitle, copy.shareBody, [
      { text: t("cancel"), style: "cancel" },
      { text: copy.startShare, onPress: () => run(() => localParticipant.setScreenShareEnabled(true, { resolution: { width: profile.screen.width, height: profile.screen.height, frameRate: profile.screen.frameRate } }, { screenShareEncoding: { maxBitrate: profile.screen.maxBitrate, maxFramerate: profile.screen.frameRate }, simulcast: profile.simulcast }), t("screenShareUnavailable")) },
    ]);
  };

  const cycleAudio = async () => {
    const detected = await AudioSession.getAudioOutputs();
    const available = detected.filter(isKnownAudioRoute);
    const route = nextAudioRoute(session.audioRoute ?? "", available.length ? available : session.audioRoutes);
    if (route) await setAudioRoute(route);
  };

  const showParticipantVolume = (participant: Participant) => {
    if (participant.isLocal) return;
    const remote = participant as RemoteParticipant;
    const apply = (volume: number) => {
      remote.setVolume(volume);
      setParticipantVolumes((current) => ({ ...current, [participant.identity]: volume }));
    };
    showDialog(copy.participantVolume, participant.name || participant.identity, [
      { text: copy.muteParticipant, onPress: () => apply(0) },
      { text: "50%", onPress: () => apply(0.5) },
      { text: "100%", onPress: () => apply(1) },
      { text: "150%", onPress: () => apply(1.5) },
      { text: t("cancel"), style: "cancel" },
    ]);
  };

  const showDetails = () => {
    const stats = session.stats;
    const lines = [
      `${copy.ping}: ${stats.pingMs === null ? "—" : `${stats.pingMs} ms`}`,
      `${copy.jitter}: ${stats.jitterMs === null ? "—" : `${stats.jitterMs} ms`}`,
      `${copy.loss}: ${stats.packetLossPercent === null ? "—" : `${stats.packetLossPercent}%`}`,
      `${copy.bitrate}: ↓ ${stats.inboundKbps} / ↑ ${stats.outboundKbps} kbit/s`,
      `${copy.codec}: ${stats.codecs.join(", ") || "—"}`,
      `${copy.transport}: ${[stats.iceCandidateType, stats.transportProtocol].filter(Boolean).join(" · ") || "—"}`,
      `${copy.reconnects}: ${session.reconnects}`,
    ];
    showDialog(copy.callDetails, lines.join("\n"), [
      { text: copy.outputTest, onPress: () => showDialog(copy.outputTest, copy.outputTestBody, [{ text: t("cancel"), style: "cancel" }, { text: copy.outputTest, onPress: () => { playCallOutputTest(); } }]) },
      ...(session.canEnd && session.kind !== "direct" ? [{ text: copy.endForEveryone, style: "destructive" as const, onPress: () => showDialog(copy.endForEveryone, copy.endForEveryoneBody, [{ text: t("cancel"), style: "cancel" }, { text: copy.endForEveryone, style: "destructive", onPress: () => { void leaveCall({ endForEveryone: true }); } }]) }] : []),
      { text: t("close"), style: "cancel" },
    ]);
  };

  return <SafeAreaView style={[styles.call, { backgroundColor: palette.background }]}>
    <View style={styles.header}>
      <View style={styles.headerCopy}><Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>{session.title}</Text><Text style={[styles.state, { color: connected ? palette.success : palette.warning }]}>{connected ? t("connected", { count: participants.length }) : connectionStateLabel(connection, t)}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={copy.minimize} onPress={onMinimize} style={styles.headerButton}><AppIcon name="chevron-down" size={28} color={palette.text} /></Pressable>
    </View>

    {screenTrack ? <View style={[styles.screenStage, { borderColor: palette.border }]}>
      <VideoTrack trackRef={screenTrack} style={styles.screenVideo} objectFit="contain" />
      <View style={styles.screenLabel}><Text style={styles.screenLabelText}>{screenTrack.participant.name || screenTrack.participant.identity} · {t("screen")}</Text></View>
    </View> : null}

    <ScrollView contentContainerStyle={[styles.participants, screenTrack && styles.participantsWithScreen]}>
      {cameraTracks.length > 0 ? <View style={styles.cameraGrid}>{cameraTracks.map((track) => <View key={`${track.participant.identity}-${track.source}`} style={[styles.cameraTile, { borderColor: track.participant.isSpeaking ? palette.success : palette.border }]}><VideoTrack trackRef={track} style={styles.cameraVideo} objectFit="cover" mirror={track.participant.isLocal} /><Text style={styles.cameraName}>{track.participant.isLocal ? t("you") : track.participant.name || track.participant.identity}</Text></View>)}</View> : null}
      <View style={styles.voiceGrid}>{participants.map((participant) => {
        const volume = participantVolumes[participant.identity] ?? 1;
        return <Pressable key={participant.identity} disabled={participant.isLocal} onLongPress={() => showParticipantVolume(participant)} accessibilityHint={participant.isLocal ? undefined : copy.participantVolume} style={[styles.person, { backgroundColor: palette.surface, borderColor: participant.isSpeaking ? palette.success : palette.border }]}>
          <Avatar uri={null} label={participant.name || participant.identity} size={58} />
          <Text numberOfLines={1} style={[styles.personName, { color: palette.text }]}>{participant.isLocal ? t("you") : participant.name || participant.identity}</Text>
          <View style={styles.personStatus}><AppIcon name={participant.isMicrophoneEnabled ? "mic" : "mic-off"} size={15} color={participant.isMicrophoneEnabled ? palette.secondaryText : palette.danger} />{!participant.isLocal ? <Pressable hitSlop={9} onPress={() => { const remote = participant as RemoteParticipant; const next = volume === 0 ? 1 : 0; remote.setVolume(next); setParticipantVolumes((current) => ({ ...current, [participant.identity]: next })); }} onLongPress={() => showParticipantVolume(participant)}><AppIcon name={volume === 0 ? "volume-mute" : "volume-high"} size={15} color={volume === 0 ? palette.danger : palette.secondaryText} /></Pressable> : null}</View>
        </Pressable>;
      })}</View>
    </ScrollView>

    <View accessibilityLabel={copy.microphoneLevel} style={[styles.meterTrack, { backgroundColor: palette.border }]}><View style={[styles.meterValue, { backgroundColor: microphoneLevel > 0.75 ? palette.warning : palette.success, width: `${Math.max(2, Math.min(100, microphoneLevel * 100))}%` }]} /></View>

    <View style={styles.controls}>
      <CallButton icon={isMicrophoneEnabled ? "mic" : "mic-off"} label={isMicrophoneEnabled ? t("muteCall") : t("unmuteCall")} active={!isMicrophoneEnabled} onPress={() => run(toggleMicrophone, t("microphoneUnavailable"))} />
      <CallButton icon={isCameraEnabled ? "videocam" : "videocam-off"} label={t("camera")} active={isCameraEnabled} onPress={() => run(toggleCamera, t("cameraUnavailable"))} />
      <CallButton icon="phone-portrait-outline" label={t("shareScreen")} active={isScreenShareEnabled} onPress={toggleScreen} />
      <CallButton icon={session.audioRoute === "earpiece" ? "ear-outline" : "volume-high"} label={audioRouteLabel(session.audioRoute, t)} active={session.audioRoute === "speaker"} onPress={() => run(cycleAudio, t("callUnavailable"))} />
      <CallButton icon="ellipsis-horizontal" label={t("more")} onPress={showDetails} />
      <CallButton icon="call" label={t("leaveCall")} danger onPress={() => { void leaveCall(); }} />
    </View>
  </SafeAreaView>;
}

type Translate = ReturnType<typeof useTranslation>["t"];

function connectionStateLabel(state: ConnectionState, t: Translate): string {
  if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) return t("callReconnecting");
  if (state === ConnectionState.Disconnected) return t("callDisconnected");
  return t("callConnecting");
}

function audioRouteLabel(route: string | null, t: Translate): string {
  if (route === "earpiece") return t("callRouteEarpiece");
  if (route === "speaker") return t("callRouteSpeaker");
  if (route === "headset") return t("callRouteHeadset");
  if (route === "bluetooth") return t("callRouteBluetooth");
  return t("audio");
}

function isKnownAudioRoute(route: string): route is "earpiece" | "speaker" | "headset" | "bluetooth" {
  return route === "earpiece" || route === "speaker" || route === "headset" || route === "bluetooth";
}

async function requestAndroidPermission(permission: typeof PermissionsAndroid.PERMISSIONS.CAMERA): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (await PermissionsAndroid.check(permission)) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

function CallButton({ icon, label, active = false, danger = false, onPress }: { icon: AppIconName; label: string; active?: boolean; danger?: boolean; onPress: () => void }) {
  const palette = usePalette();
  const background = danger ? palette.danger : active ? palette.accent : palette.elevated;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}><View style={[styles.controlCircle, { backgroundColor: background }]}><AppIcon name={icon} size={22} color={danger || active ? "white" : palette.text} /></View><Text numberOfLines={1} style={[styles.controlLabel, { color: palette.secondaryText }]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  call: { flex: 1 },
  header: { minHeight: 62, flexDirection: "row", alignItems: "center", paddingHorizontal: 18 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 19, lineHeight: 24, fontWeight: "800" },
  state: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  screenStage: { height: "46%", marginHorizontal: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 15, overflow: "hidden", backgroundColor: "#050505" },
  screenVideo: { width: "100%", height: "100%" },
  screenLabel: { position: "absolute", left: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.68)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  screenLabelText: { color: "white", fontSize: 11, lineHeight: 14, fontWeight: "700" },
  participants: { flexGrow: 1, justifyContent: "center", padding: 14 },
  participantsWithScreen: { justifyContent: "flex-start" },
  cameraGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  cameraTile: { width: "48%", aspectRatio: 0.9, borderWidth: 2, borderRadius: 13, overflow: "hidden", backgroundColor: "black" },
  cameraVideo: { width: "100%", height: "100%" },
  cameraName: { position: "absolute", left: 7, bottom: 7, color: "white", fontSize: 11, fontWeight: "700", textShadowColor: "black", textShadowRadius: 4 },
  voiceGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 },
  person: { width: 112, minHeight: 128, borderWidth: 2, borderRadius: 15, alignItems: "center", justifyContent: "center", padding: 10 },
  personName: { width: "100%", textAlign: "center", fontSize: 13, lineHeight: 17, fontWeight: "700", marginTop: 7 },
  personStatus: { minHeight: 20, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  meterTrack: { height: 3, marginHorizontal: 18, borderRadius: 2, overflow: "hidden" },
  meterValue: { height: "100%", borderRadius: 2 },
  controls: { minHeight: 94, flexDirection: "row", justifyContent: "space-evenly", alignItems: "flex-start", paddingHorizontal: 4, paddingTop: 9 },
  control: { width: 58, alignItems: "center" },
  controlPressed: { opacity: 0.62, transform: [{ scale: 0.96 }] },
  controlCircle: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  controlLabel: { width: 58, textAlign: "center", fontSize: 10, lineHeight: 13, marginTop: 5 },
});
