import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";

type IconName = ComponentProps<typeof Ionicons>["name"];

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
}

export function ScreenHeader({ title, subtitle, left, right = [], center }: ScreenHeaderProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.outer, { paddingTop: insets.top, backgroundColor: palette.background, borderColor: palette.border }]}>
      <View style={styles.row}>
        <View style={styles.side}>
          {left ? <HeaderButton {...left} /> : null}
        </View>
        <View style={styles.center}>
          {center ?? (
            <>
              <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>{title}</Text>
              {subtitle ? <Text numberOfLines={1} style={[styles.subtitle, { color: palette.secondaryText }]}>{subtitle}</Text> : null}
            </>
          )}
        </View>
        <View style={[styles.side, styles.right]}>
          {right.slice(0, 2).map((action) => <HeaderButton key={action.label} {...action} />)}
        </View>
      </View>
    </View>
  );
}

function HeaderButton({ icon, label, onPress }: HeaderAction) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress} style={styles.button}>
      <Ionicons name={icon} size={23} color={palette.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  side: { width: 84, flexDirection: "row", alignItems: "center" },
  right: { justifyContent: "flex-end" },
  center: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  title: { fontSize: 17, lineHeight: 21, fontWeight: "700" },
  subtitle: { fontSize: 12, lineHeight: 15, marginTop: 1 },
  button: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
