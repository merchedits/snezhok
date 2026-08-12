import { RoomContext } from "@livekit/react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ActiveCallConflictError, useCallSession } from "../calls/CallSessionProvider";
import { CallRoomView } from "../calls/CallRoomView";
import { callCopy } from "../calls/callStrings";
import { AppIcon } from "../components/AppIcon";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { userFacingError } from "../lib/userFacingError";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Call">;

/**
 * The screen is now only a view onto the app-level call session. Navigating
 * away minimizes the call; it never owns or tears down the LiveKit Room.
 */
export function CallScreen({ navigation, route }: Props) {
  const palette = usePalette();
  const { t } = useTranslation();
  const language = useAppStore((state) => state.settings.language);
  const copy = callCopy(language);
  const { room, session, startCall, setCallScreenVisible } = useCallSession();
  const [error, setError] = useState<string | null>(null);
  const requestedStream = useRef<string | null>(null);
  const hadMatchingSession = useRef(false);
  const startWithVideo = route.params.startWithVideo;

  useEffect(() => {
    setCallScreenVisible(true);
    return () => setCallScreenVisible(false);
  }, [setCallScreenVisible]);

  useEffect(() => {
    if (requestedStream.current === route.params.streamId) return;
    requestedStream.current = route.params.streamId;
    setError(null);
    void startCall({ streamId: route.params.streamId, title: route.params.title, ...(startWithVideo === undefined ? {} : { startWithVideo }), ...(route.params.expectedCallId ? { expectedCallId: route.params.expectedCallId } : {}) }).catch((reason: unknown) => {
      setError(reason instanceof ActiveCallConflictError ? copy.alreadyActive : userFacingError(reason, t, "callUnavailable"));
    });
  }, [copy.alreadyActive, route.params.expectedCallId, route.params.streamId, route.params.title, startCall, startWithVideo, t]);

  useEffect(() => {
    if (session?.streamId === route.params.streamId) hadMatchingSession.current = true;
    else if (hadMatchingSession.current && !session) navigation.goBack();
  }, [navigation, room, route.params.streamId, session]);

  if (error) return <SafeAreaView style={[styles.center, { backgroundColor: palette.background }]}>
    <AppIcon name="warning-outline" size={42} color={palette.danger} />
    <Text style={[styles.errorTitle, { color: palette.text }]}>{t("callUnavailable")}</Text>
    <Text style={[styles.errorText, { color: palette.secondaryText }]}>{error}</Text>
    <Pressable onPress={navigation.goBack} style={[styles.button, { backgroundColor: palette.accent }]}><Text style={styles.buttonText}>{t("goBack")}</Text></Pressable>
  </SafeAreaView>;

  if (!room || session?.streamId !== route.params.streamId) return <SafeAreaView style={[styles.center, { backgroundColor: palette.background }]}>
    <ActivityIndicator size="large" color={palette.accent} />
    <Text style={[styles.connecting, { color: palette.secondaryText }]}>{t("joiningCall", { title: route.params.title })}</Text>
  </SafeAreaView>;

  return <RoomContext.Provider value={room}><CallRoomView onMinimize={navigation.goBack} /></RoomContext.Provider>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  connecting: { fontSize: 14, lineHeight: 19, marginTop: 14 },
  errorTitle: { fontSize: 20, lineHeight: 25, fontWeight: "800", marginTop: 14 },
  errorText: { fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 7 },
  button: { height: 44, borderRadius: 12, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", marginTop: 22 },
  buttonText: { color: "white", fontWeight: "800" },
});
