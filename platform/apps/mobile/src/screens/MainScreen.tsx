import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, type LayoutChangeEvent, StyleSheet, View } from "react-native";

import { BottomNavigation } from "../components/BottomNavigation";
import { usePalette } from "../hooks/usePalette";
import { MAIN_TABS, mainTabIndex, type MainTab } from "../navigation/mainTabs";
import { useAppStore } from "../store/useAppStore";
import { ChatsScreen } from "./ChatsScreen";
import { ProfileScreen } from "./ProfileScreen";
import { ServersScreen } from "./ServersScreen";
import { SettingsScreen } from "./SettingsScreen";

export function MainScreen() {
  const palette = usePalette();
  const [tab, setTab] = useState<MainTab>("chats");
  const [pageWidth, setPageWidth] = useState(0);
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const position = useRef(new Animated.Value(mainTabIndex("chats"))).current;

  useEffect(() => {
    if (reducedMotion) {
      position.stopAnimation();
      position.setValue(mainTabIndex(tab));
    }
  }, [position, reducedMotion, tab]);

  const selectTab = (next: MainTab) => {
    if (next === tab) return;
    const nextIndex = mainTabIndex(next);
    setTab(next);
    position.stopAnimation();
    if (reducedMotion) {
      position.setValue(nextIndex);
      return;
    }
    Animated.timing(position, {
      toValue: nextIndex,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const measurePages = (event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width > 0 && width !== pageWidth) setPageWidth(width);
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}> 
      <View style={styles.viewport} onLayout={measurePages}>
        <Animated.View
          style={[
            styles.track,
            { width: pageWidth * MAIN_TABS.length, transform: [{ translateX: Animated.multiply(position, -pageWidth) }] },
          ]}
        >
          <TabPage width={pageWidth} active={tab === "chats"}><ChatsScreen embedded /></TabPage>
          <TabPage width={pageWidth} active={tab === "servers"}><ServersScreen /></TabPage>
          <TabPage width={pageWidth} active={tab === "profile"}><ProfileScreen embedded /></TabPage>
          <TabPage width={pageWidth} active={tab === "settings"}><SettingsScreen embedded /></TabPage>
        </Animated.View>
      </View>
      <BottomNavigation selected={tab} onSelect={selectTab} />
    </View>
  );
}

function TabPage({ width, active, children }: { width: number; active: boolean; children: ReactNode }) {
  return <View style={[styles.page, { width }]} accessibilityElementsHidden={!active} importantForAccessibility={active ? "auto" : "no-hide-descendants"}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  viewport: { flex: 1, overflow: "hidden" },
  track: { flex: 1, flexDirection: "row" },
  page: { height: "100%" },
});
