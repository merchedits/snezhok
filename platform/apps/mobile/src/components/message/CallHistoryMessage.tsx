import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Message } from "@snezhok/contracts";

import { callDurationLabel, parseCallHistoryEvent } from "../../domains/messaging/callHistory";
import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { AppIcon } from "../AppIcon";

export function CallHistoryMessage({ message, mine, selected, onLongPress }: { message: Message; mine: boolean; selected: boolean; onLongPress?: () => void }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const event = parseCallHistoryEvent(message.text);
  if (!event) return null;
  const label = event.status === "missed" ? t(mine ? "unansweredOutgoingCall" : "missedCall") : t("completedCall");
  return <View style={styles.row}><Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${callDurationLabel(event.durationMs)}`} delayLongPress={240} onLongPress={onLongPress} style={[styles.card, { backgroundColor: selected ? palette.accentSoft : palette.surface, borderColor: selected ? palette.accent : palette.border }]}>
    <AppIcon name={event.status === "missed" ? "call-outline" : "call"} size={18} color={event.status === "missed" ? palette.danger : palette.accent} />
    <View><Text style={[styles.label, { color: palette.text }]}>{label}</Text><Text style={[styles.detail, { color: palette.secondaryText }]}>{callDurationLabel(event.durationMs)} · {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text></View>
  </Pressable></View>;
}

const styles = StyleSheet.create({ row: { width: "100%", alignItems: "center", paddingVertical: 4 }, card: { minHeight: 48, maxWidth: "82%", borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 9 }, label: { fontSize: 13, lineHeight: 17, fontWeight: "800" }, detail: { marginTop: 1, fontSize: 11, lineHeight: 14 } });
