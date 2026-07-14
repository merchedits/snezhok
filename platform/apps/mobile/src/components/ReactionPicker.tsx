import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { QUICK_REACTIONS } from "../lib/quickReactions";

export function ReactionPicker({
  visible,
  anchorY,
  activeEmojis,
  onClose,
  onSelect,
}: {
  visible: boolean;
  anchorY: number;
  activeEmojis: ReadonlySet<string>;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const top = Math.max(insets.top + 12, Math.min(anchorY - 62, height - insets.bottom - 76));

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent navigationBarTranslucent={false} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close reactions" onPress={onClose} style={styles.backdrop} />
        <View style={[styles.picker, { top, backgroundColor: palette.elevated, borderColor: palette.border }]}>
          {QUICK_REACTIONS.map((emoji) => {
            const active = activeEmojis.has(emoji);
            return (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={emoji}
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(emoji)}
                style={({ pressed }) => [styles.reaction, active && { backgroundColor: palette.accentSoft }, { transform: [{ scale: pressed ? 0.9 : 1 }] }]}
              >
                <Text style={styles.emoji}>{emoji}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.18)" },
  picker: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 25,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  reaction: { width: 43, height: 43, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 25, lineHeight: 31 },
});
