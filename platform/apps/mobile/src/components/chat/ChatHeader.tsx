import { Pressable, StyleSheet, Text, View } from "react-native";

import type { UserSummary } from "@snezhok/contracts";

import { usePalette } from "../../hooks/usePalette";
import { useUiPreferences } from "../../hooks/useUiPreferences";
import { useTranslation } from "../../i18n";
import { Avatar } from "../Avatar";
import { ScreenHeader } from "../ScreenHeader";

interface Props {
  title: string;
  subtitle?: string;
  peer?: UserSummary;
  selectedCount: number;
  activitiesAvailable: boolean;
  scheduledCount: number;
  callsAvailable: boolean;
  onBack: () => void;
  onCancelSelection: () => void;
  onOpenProfile: (userId: string) => void;
  onOpenActivities: () => void;
  onOpenScheduled: () => void;
  onStartCall: () => void;
  onSearch: () => void;
}

export function ChatHeader(props: Props) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const { t, language } = useTranslation();
  if (props.selectedCount > 0) {
    return (
      <ScreenHeader
        tone="chat"
        title={String(props.selectedCount)}
        left={{ icon: "close", label: t("cancel"), onPress: props.onCancelSelection }}
      />
    );
  }
  return (
    <ScreenHeader
      tone="chat"
      title={props.title}
      {...(props.subtitle ? { subtitle: props.subtitle } : {})}
      left={{ icon: "chevron-back", label: t("back"), onPress: props.onBack }}
      center={props.peer ? (
        <Pressable onPress={() => props.onOpenProfile(props.peer!.id)} style={styles.identity} accessibilityRole="button">
          <Avatar uri={props.peer.avatarUrl} label={props.peer.displayName} color={props.peer.avatarColor} online={props.peer.presence === "online"} size={34} />
          <View style={styles.copy}>
            <Text numberOfLines={1} style={[styles.title, { color: palette.text, fontSize: ui.font(15) }]}>{props.peer.displayName}</Text>
            <Text numberOfLines={1} style={[styles.subtitle, { color: props.peer.presence === "online" ? palette.success : palette.secondaryText, fontSize: ui.font(11) }]}>
              {props.peer.presence === "online" ? t("online") : t("lastSeen", { date: formatLastSeen(props.peer.lastSeenAt) })}
            </Text>
          </View>
        </Pressable>
      ) : undefined}
      right={[
        ...(props.activitiesAvailable ? [{
          icon: "sparkles-outline" as const,
          label: language === "ru" ? "Сделать вместе" : "Do something together",
          onPress: props.onOpenActivities,
        }] : []),
        ...(props.scheduledCount > 0 ? [{ icon: "time-outline" as const, label: t("scheduledMessages"), onPress: props.onOpenScheduled }] : []),
        ...(props.callsAvailable ? [{ icon: "call-outline" as const, label: t("startCall"), onPress: props.onStartCall }] : []),
        { icon: "search", label: t("search"), onPress: props.onSearch },
      ]}
    />
  );
}

function formatLastSeen(timestamp: number): string {
  if (!timestamp) return "—";
  const value = new Date(timestamp);
  const now = new Date();
  if (value.toDateString() === now.toDateString()) return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return value.toLocaleDateString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  identity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 18 },
  copy: { minWidth: 0, maxWidth: 150 },
  title: { lineHeight: 18, fontWeight: "800" },
  subtitle: { lineHeight: 14, marginTop: 1 },
});
