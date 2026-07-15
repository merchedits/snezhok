import { AppIcon, type AppIconName } from "./AppIcon";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import type { MainTab } from "../navigation/mainTabs";
import { useAppStore } from "../store/useAppStore";

export type { MainTab } from "../navigation/mainTabs";

const tabs: Array<{ id: MainTab; icon: AppIconName; activeIcon: AppIconName }> = [
  { id: "chats", icon: "chatbubbles-outline", activeIcon: "chatbubbles" },
  { id: "servers", icon: "albums-outline", activeIcon: "albums" },
  { id: "profile", icon: "person-circle-outline", activeIcon: "person-circle" },
  { id: "settings", icon: "settings-outline", activeIcon: "settings" },
];

export const BottomNavigation = memo(function BottomNavigation({ selected, onSelect }: { selected: MainTab; onSelect: (tab: MainTab) => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <View style={[styles.nav, { minHeight: 62 + insets.bottom, paddingBottom: insets.bottom + 4, backgroundColor: palette.background, borderColor: palette.border }]}>
      {tabs.map((tab) => <TabButton key={tab.id} tab={tab} active={selected === tab.id} label={t(tab.id)} onSelect={onSelect} />)}
    </View>
  );
});

const TabButton = memo(function TabButton({ tab, active, label, onSelect }: { tab: (typeof tabs)[number]; active: boolean; label: string; onSelect: (tab: MainTab) => void }) {
  const palette = usePalette();
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, {
      duration: reducedMotion ? 0 : 140,
      easing: Easing.out(Easing.cubic),
    });
  }, [active, progress, reducedMotion]);
  const iconStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ["transparent", palette.accentSoft]),
    transform: [{ translateY: 1 - progress.value }, { scale: 0.94 + progress.value * 0.06 }],
  }), [palette.accentSoft]);
  const onPress = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    onSelect(tab.id);
  }, [onSelect, tab.id]);
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label} onPress={onPress} style={styles.tab} android_ripple={{ color: palette.accentSoft, borderless: false }}>
      <Animated.View style={[styles.iconWrap, iconStyle]}>
        <AppIcon name={active ? tab.activeIcon : tab.icon} size={23} color={active ? palette.accent : palette.secondaryText} strokeWidth={active ? 2 : 1.8} />
      </Animated.View>
      <Text numberOfLines={1} style={[styles.label, { color: active ? palette.accent : palette.secondaryText }]}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  nav: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 18, overflow: "hidden" },
  iconWrap: { width: 44, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  label: { maxWidth: "96%", fontSize: 10.5, fontWeight: "700" },
});
