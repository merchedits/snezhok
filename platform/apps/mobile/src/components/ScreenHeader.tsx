import { AppIcon, type AppIconName } from "./AppIcon";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useUiPreferences } from "../hooks/useUiPreferences";

type IconName = AppIconName;

interface HeaderAction {
  icon: IconName;
  label: string;
  onPress: () => void;
}

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  left?: HeaderAction;
  right?: HeaderAction[];
  center?: ReactNode;
  prominent?: boolean;
  tone?: "default" | "chat" | "profile" | "settings";
}

export function ScreenHeader({ title, subtitle, left, right = [], center, prominent = false, tone = "default" }: ScreenHeaderProps) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const insets = useSafeAreaInsets();
  const backgroundColor = tone === "chat" ? palette.chatCanvas : tone === "profile" ? palette.profileCanvas : tone === "settings" ? palette.settingsCanvas : palette.background;
  const visibleActions = right.slice(0, 3);
  // Both sides reserve the same physical width. Asymmetric header slots make a
  // mathematically centered title look visibly off-center, especially on the
  // main Profile and Chats screens.
  const sideWidth = Math.max(left ? 44 : 0, visibleActions.length * 44, 44);
  return (
    <View style={[styles.outer, { paddingTop: insets.top, backgroundColor }]}>
      <View style={[styles.row, prominent && styles.prominentRow, { minHeight: prominent ? ui.dense(68, 60) : ui.dense(52, 46) }]}>
        <View style={[styles.side, { width: sideWidth }]}>
          {left ? <HeaderButton {...left} /> : null}
        </View>
        <View style={[styles.center, prominent && styles.prominentCenter]}>
          {center ?? (
            <>
              <Text numberOfLines={1} style={[styles.title, prominent && styles.prominentTitle, { color: palette.text, fontSize: ui.font(prominent ? 28 : 17), lineHeight: ui.font(prominent ? 33 : 21) }]}>{title}</Text>
              {subtitle ? <Text numberOfLines={1} style={[styles.subtitle, { color: palette.secondaryText, fontSize: ui.font(12), lineHeight: ui.font(15) }]}>{subtitle}</Text> : null}
            </>
          )}
        </View>
        <View style={[styles.side, styles.right, { width: sideWidth }]}>
          {visibleActions.map((action) => <HeaderButton key={action.label} {...action} />)}
        </View>
      </View>
    </View>
  );
}

function HeaderButton({ icon, label, onPress }: HeaderAction) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress} style={({ pressed }) => [styles.button, { backgroundColor: pressed ? palette.accentSoft : "transparent", opacity: pressed ? 0.76 : 1 }]}>
      <AppIcon name={icon} size={23} color={palette.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: {},
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  prominentRow: { paddingHorizontal: 20 },
  side: { flexDirection: "row", alignItems: "center" },
  right: { justifyContent: "flex-end" },
  center: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  prominentCenter: { alignItems: "center" },
  title: { fontSize: 17, lineHeight: 21, fontWeight: "700" },
  prominentTitle: { fontWeight: "800", letterSpacing: -0.8 },
  subtitle: { fontSize: 12, lineHeight: 15, marginTop: 1 },
  button: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
