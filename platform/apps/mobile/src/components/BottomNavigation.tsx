import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";

export type MainTab = "chats" | "servers" | "profile" | "settings";

const tabs: Array<{ id: MainTab; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap }> = [
  { id: "chats", icon: "chatbubbles-outline", activeIcon: "chatbubbles" },
  { id: "servers", icon: "albums-outline", activeIcon: "albums" },
  { id: "profile", icon: "person-circle-outline", activeIcon: "person-circle" },
  { id: "settings", icon: "settings-outline", activeIcon: "settings" },
];

export function BottomNavigation({ selected, onSelect }: { selected: MainTab; onSelect: (tab: MainTab) => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <View style={[styles.nav, { minHeight: 58 + insets.bottom, paddingBottom: insets.bottom, backgroundColor: palette.background, borderColor: palette.border }]}> 
      {tabs.map((tab) => {
        const active = selected === tab.id;
        return (
          <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={t(tab.id)} onPress={() => onSelect(tab.id)} style={styles.tab}>
            <View style={[styles.iconWrap, { backgroundColor: active ? palette.accentSoft : "transparent" }]}>
              <Ionicons name={active ? tab.activeIcon : tab.icon} size={23} color={active ? palette.accent : palette.secondaryText} />
            </View>
            <Text numberOfLines={1} style={[styles.label, { color: active ? palette.accent : palette.secondaryText }]}>{t(tab.id)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 2 },
  iconWrap: { minWidth: 42, height: 29, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  label: { maxWidth: "96%", fontSize: 10.5, fontWeight: "700" },
});
