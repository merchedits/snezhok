import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon, type AppIconName } from "../AppIcon";
import { usePalette } from "../../hooks/usePalette";

export interface ChatSelectionAction {
  icon: AppIconName;
  label: string;
  danger?: boolean;
  onPress: () => void;
}

interface Props {
  actions: readonly ChatSelectionAction[];
  bottomInset: number;
}

export function ChatSelectionToolbar({ actions, bottomInset }: Props) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.toolbar,
        {
          paddingBottom: Math.max(bottomInset + 8, 16),
          borderColor: palette.border,
          backgroundColor: palette.composer,
        },
      ]}
    >
      {actions.map((action) => (
        <Pressable
          key={`${action.icon}:${action.label}`}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.55 : 1 }]}
        >
          <AppIcon name={action.icon} size={23} color={action.danger ? palette.danger : palette.accent} />
          <Text numberOfLines={1} style={[styles.label, { color: action.danger ? palette.danger : palette.secondaryText }]}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "flex-start",
    borderTopWidth: 1.5,
    paddingTop: 7,
    paddingHorizontal: 4,
  },
  action: {
    flex: 1,
    minWidth: 0,
    minHeight: 47,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  label: {
    maxWidth: "100%",
    paddingHorizontal: 2,
    fontSize: 10,
    fontWeight: "600",
  },
});
