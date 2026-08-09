import { AppIcon, type AppIconName } from "./AppIcon";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
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
    <View style={[styles.nav, { minHeight: ui.dense(66, 60) + insets.bottom, paddingBottom: insets.bottom + 5, backgroundColor: palette.navigation, borderColor: palette.outline }]}>
      {tabs.map((tab) => <TabButton key={tab.id} tab={tab} active={selected === tab.id} label={t(tab.id)} onSelect={onSelect} />)}
    </View>
  );
});

const TabButton = memo(function TabButton({ tab, active, label, onSelect }: { tab: (typeof tabs)[number]; active: boolean; label: string; onSelect: (tab: MainTab) => void }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const activeFill = tab.id === "profile" ? palette.moment.mint : tab.id === "settings" ? palette.moment.lavender : palette.accent;
  const activeForeground = tab.id === "chats" ? palette.onAccent : palette.text;
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, {
      duration: reducedMotion ? 0 : 140,
      easing: Easing.out(Easing.cubic),
    });
  }, [active, progress, reducedMotion]);
  const iconStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ["transparent", activeFill]),
    transform: [{ translateY: 1 - progress.value * 3 }, { scale: 0.94 + progress.value * 0.06 }],
  }), [activeFill]);
  const onPress = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    onSelect(tab.id);
  }, [onSelect, tab.id]);
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label} onPress={onPress} style={styles.tab} android_ripple={{ color: palette.accentSoft, borderless: false }}>
      <Animated.View style={[styles.iconWrap, iconStyle]}>
        <AppIcon name={active ? tab.activeIcon : tab.icon} size={23} color={active ? activeForeground : palette.secondaryText} strokeWidth={active ? 2 : 1.8} />
      </Animated.View>
      <Text numberOfLines={1} style={[styles.label, { color: active ? palette.text : palette.secondaryText, fontSize: ui.font(11) }]}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  nav: { flexDirection: "row", borderTopWidth: 1.5 },
  tab: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 18, overflow: "hidden" },
  iconWrap: { width: 48, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  label: { maxWidth: "96%", fontSize: 11, fontWeight: "800" },
});
