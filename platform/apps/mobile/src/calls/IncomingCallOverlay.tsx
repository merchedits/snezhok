import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "../components/AppIcon";
import { Avatar } from "../components/Avatar";
import { usePalette } from "../hooks/usePalette";
import { callCopy, interpolateCallCopy, type CallLanguage } from "./callStrings";

export interface IncomingCallViewModel {
  roomId: string;
  callerName: string;
  title: string;
}

export function IncomingCallOverlay({ call, language, onAnswer, onDecline }: {
  call: IncomingCallViewModel | null;
  language: CallLanguage;
  onAnswer: (video: boolean) => void;
  onDecline: () => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const copy = callCopy(language);
  const handled = useRef(false);

  useEffect(() => {
    handled.current = false;
    if (call) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  }, [call?.roomId]);

  const once = (action: () => void) => {
    if (handled.current) return;
    handled.current = true;
    action();
  };

  return (
    <Modal visible={Boolean(call)} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => once(onDecline)}>
      <View accessibilityViewIsModal style={[styles.layer, { paddingTop: Math.max(24, insets.top), paddingBottom: Math.max(24, insets.bottom), backgroundColor: palette.overlay }]}>
        {call ? <View style={[styles.card, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
          <View style={[styles.pulse, { borderColor: `${palette.accent}55` }]}>
            <Avatar uri={null} label={call.callerName} size={86} />
          </View>
          <Text accessibilityRole="header" style={[styles.eyebrow, { color: palette.accent }]}>{copy.incoming}</Text>
          <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>{call.title}</Text>
          <Text style={[styles.subtitle, { color: palette.secondaryText }]}>{interpolateCallCopy(copy.incomingFrom, { name: call.callerName })}</Text>
          <View style={styles.actions}>
            <IncomingAction icon="videocam" label={copy.acceptVideo} background={palette.accent} onPress={() => once(() => onAnswer(true))} />
            <IncomingAction icon="call" label={copy.acceptAudio} background={palette.success} onPress={() => once(() => onAnswer(false))} />
            <IncomingAction icon="call" label={copy.decline} background={palette.danger} rotation={135} onPress={() => once(onDecline)} />
          </View>
        </View> : null}
      </View>
    </Modal>
  );
}

function IncomingAction({ icon, label, background, rotation = 0, onPress }: { icon: AppIconName; label: string; background: string; rotation?: number; onPress: () => void }) {
  const palette = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
    <View style={[styles.actionCircle, { backgroundColor: background, transform: [{ rotate: `${rotation}deg` }] }]}><AppIcon name={icon} size={25} color="white" strokeWidth={2} /></View>
    <Text numberOfLines={1} style={[styles.actionLabel, { color: palette.text }]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  layer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  card: { width: "100%", maxWidth: 390, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", paddingHorizontal: 20, paddingTop: 30, paddingBottom: 24, elevation: 24, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 30, shadowOffset: { width: 0, height: 18 } },
  pulse: { width: 104, height: 104, borderRadius: 52, borderWidth: 7, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontSize: 13, lineHeight: 17, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 20 },
  title: { maxWidth: "100%", fontSize: 25, lineHeight: 31, fontWeight: "800", marginTop: 7 },
  subtitle: { fontSize: 14, lineHeight: 19, marginTop: 4 },
  actions: { width: "100%", flexDirection: "row", justifyContent: "space-around", marginTop: 30 },
  action: { width: 88, alignItems: "center" },
  pressed: { opacity: 0.65, transform: [{ scale: 0.96 }] },
  actionCircle: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center" },
  actionLabel: { width: 88, textAlign: "center", fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 8 },
});
