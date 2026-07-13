import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import type { MainTab } from "../navigation/mainTabs";
import { useAppStore } from "../store/useAppStore";

export type { MainTab } from "../navigation/mainTabs";

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
      {tabs.map((tab) => <TabButton key={tab.id} tab={tab} active={selected === tab.id} label={t(tab.id)} onPress={() => onSelect(tab.id)} />)}
    </View>
  );
}

function TabButton({ tab, active, label, onPress }: { tab: (typeof tabs)[number]; active: boolean; label: string; onPress: () => void }) {
  const palette = usePalette();
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(active ? 1 : 0);
      return;
    }
    Animated.spring(progress, { toValue: active ? 1 : 0, damping: 18, stiffness: 260, mass: 0.7, useNativeDriver: true }).start();
  }, [active, progress, reducedMotion]);
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label} onPress={onPress} style={styles.tab} android_ripple={{ color: palette.accentSoft, borderless: false }}>
      <Animated.View style={[styles.iconWrap, { backgroundColor: active ? palette.accentSoft : "transparent", transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }, { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.93, 1] }) }] }]}>
        <Ionicons name={active ? tab.activeIcon : tab.icon} size={23} color={active ? palette.accent : palette.secondaryText} />
      </Animated.View>
      <Text numberOfLines={1} style={[styles.label, { color: active ? palette.accent : palette.secondaryText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 18, overflow: "hidden" },
  iconWrap: { width: 44, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  label: { maxWidth: "96%", fontSize: 10.5, fontWeight: "700" },
});
