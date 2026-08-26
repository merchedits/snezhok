import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { UserSummary } from "@snezhok/contracts";

import { usePalette } from "../../hooks/usePalette";
import { useUiPreferences } from "../../hooks/useUiPreferences";
import { useTranslation } from "../../i18n";
import { AppIcon, type AppIconName } from "../AppIcon";
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
  const insets = useSafeAreaInsets();
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

  const actions: Array<{ icon: AppIconName; label: string; onPress: () => void }> = [
    ...(props.activitiesAvailable ? [{
      icon: "sparkles-outline" as const,
      label: language === "ru" ? "Сделать вместе" : "Do something together",
      onPress: props.onOpenActivities,
    }] : []),
    ...(props.scheduledCount > 0 ? [{ icon: "time-outline" as const, label: t("scheduledMessages"), onPress: props.onOpenScheduled }] : []),
    ...(props.callsAvailable ? [{ icon: "call-outline" as const, label: t("startCall"), onPress: props.onStartCall }] : []),
    { icon: "search", label: t("search"), onPress: props.onSearch },
  ];

  return (
    <View style={[styles.outer, { paddingTop: insets.top, backgroundColor: palette.chatCanvas }]}>
      <View style={styles.row}>
        <HeaderSegmentButton icon="chevron-back" label={t("back")} onPress={props.onBack} />
        <Pressable
          disabled={!props.peer}
          onPress={() => props.peer && props.onOpenProfile(props.peer.id)}
          accessibilityRole={props.peer ? "button" : undefined}
          style={({ pressed }) => [
            styles.identity,
            { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.78 : 1 },
          ]}
        >
          {props.peer ? <Avatar uri={props.peer.avatarUrl} label={props.peer.displayName} color={props.peer.avatarColor} online={props.peer.presence === "online"} size={38} /> : null}
          <View style={styles.copy}>
            <Text numberOfLines={1} style={[styles.title, { color: palette.text, fontSize: ui.font(15) }]}>{props.peer?.displayName ?? props.title}</Text>
            <Text numberOfLines={1} style={[styles.subtitle, { color: props.peer?.presence === "online" ? palette.success : palette.secondaryText, fontSize: ui.font(11) }]}>
              {props.peer
                ? props.peer.presence === "online" ? t("online") : t("lastSeen", { date: formatLastSeen(props.peer.lastSeenAt) })
                : props.subtitle}
            </Text>
          </View>
        </Pressable>
        <View style={[styles.actions, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {actions.map((action) => <HeaderAction key={action.label} {...action} />)}
        </View>
      </View>
    </View>
  );
}

function HeaderSegmentButton({ icon, label, onPress }: { icon: AppIconName; label: string; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.back, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.76 : 1 }]}
    >
      <AppIcon name={icon} size={23} color={palette.text} />
    </Pressable>
  );
}

function HeaderAction({ icon, label, onPress }: { icon: AppIconName; label: string; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: pressed ? palette.accentSoft : "transparent" }]}
    >
      <AppIcon name={icon} size={21} color={palette.text} />
    </Pressable>
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
  outer: {},
  row: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, paddingVertical: 5 },
  back: { width: 46, height: 46, borderRadius: 23, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  identity: { flex: 1, minWidth: 90, height: 46, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 23, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 5, paddingRight: 9 },
  copy: { flex: 1, minWidth: 0 },
  title: { lineHeight: 18, fontWeight: "800" },
  subtitle: { lineHeight: 14, marginTop: 1 },
  actions: { height: 46, flexDirection: "row", alignItems: "center", borderRadius: 23, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 2 },
  action: { width: 34, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
