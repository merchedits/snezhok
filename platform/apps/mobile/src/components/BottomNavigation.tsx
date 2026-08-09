import { AppIcon, type AppIconName } from "./AppIcon";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useUiPreferences } from "../hooks/useUiPreferences";
import { useTranslation } from "../i18n";
import { MAIN_TABS, type MainTab } from "../navigation/mainTabs";
import { useAppStore } from "../store/useAppStore";

export type { MainTab } from "../navigation/mainTabs";

const tabDefinitions: Record<MainTab, { icon: AppIconName; activeIcon: AppIconName }> = {
  chats: { icon: "chatbubbles-outline", activeIcon: "chatbubbles" },
  servers: { icon: "albums-outline", activeIcon: "albums" },
  profile: { icon: "person-circle-outline", activeIcon: "person-circle" },
  settings: { icon: "settings-outline", activeIcon: "settings" },
};

const tabs = MAIN_TABS.map((id) => ({ id, ...tabDefinitions[id] }));

export const BottomNavigation = memo(function BottomNavigation({ selected, onSelect }: { selected: MainTab; onSelect: (tab: MainTab) => void }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <View style={[styles.shell, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: palette.background }]}>
    <View style={[styles.nav, { minHeight: ui.dense(66, 60), backgroundColor: palette.navigation }]}>
      {tabs.map((tab) => <TabButton key={tab.id} tab={tab} active={selected === tab.id} label={t(tab.id)} onSelect={onSelect} />)}
    </View>
    </View>
  );
});

const TabButton = memo(function TabButton({ tab, active, label, onSelect }: { tab: (typeof tabs)[number]; active: boolean; label: string; onSelect: (tab: MainTab) => void }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const activeFill = palette.pop;
  const activeForeground = palette.onPop;
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, {
      duration: reducedMotion ? 0 : 140,
      easing: Easing.out(Easing.cubic),
    });
  }, [active, progress, reducedMotion]);
  const selectionStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.92 + progress.value * 0.08 }],
  }), [activeFill]);
  const onPress = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    onSelect(tab.id);
  }, [onSelect, tab.id]);
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.72 : 1 }]}>
      <Animated.View pointerEvents="none" style={[styles.selectionFill, { backgroundColor: activeFill }, selectionStyle]} />
      <View style={styles.iconWrap}>
        <AppIcon name={active ? tab.activeIcon : tab.icon} size={23} color={active ? activeForeground : "#F4EDFF"} weight={active ? "fill" : "bold"} />
      </View>
      <Text numberOfLines={1} style={[styles.label, { color: active ? palette.onPop : "#F4EDFF", fontSize: ui.font(11) }]}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  shell: { paddingHorizontal: 10, paddingTop: 6 },
  nav: { flexDirection: "row", borderRadius: 26, overflow: "hidden" },
  tab: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 1, borderRadius: 20, overflow: "hidden" },
  selectionFill: { position: "absolute", left: 4, right: 4, top: 5, bottom: 5, borderRadius: 18 },
  iconWrap: { width: 48, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  label: { maxWidth: "96%", fontSize: 11, fontWeight: "700" },
});
