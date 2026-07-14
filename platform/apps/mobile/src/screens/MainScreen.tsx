import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, type LayoutChangeEvent, StyleSheet, View } from "react-native";

import { BottomNavigation } from "../components/BottomNavigation";
import { usePalette } from "../hooks/usePalette";
import { mainTabTransition, type MainTab } from "../navigation/mainTabs";
import { useAppStore } from "../store/useAppStore";
import { ChatsScreen } from "./ChatsScreen";
import { ProfileScreen } from "./ProfileScreen";
import { ServersScreen } from "./ServersScreen";
import { SettingsScreen } from "./SettingsScreen";

export function MainScreen() {
  const palette = usePalette();
  const [tab, setTab] = useState<MainTab>("chats");
  const [pageWidth, setPageWidth] = useState(0);
  const [transition, setTransition] = useState<ReturnType<typeof mainTabTransition> | null>(null);
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const progress = useRef(new Animated.Value(1)).current;
  const transitionId = useRef(0);

  useEffect(() => {
    if (reducedMotion && transition) {
      transitionId.current += 1;
      progress.stopAnimation();
      progress.setValue(1);
      setTransition(null);
    }
  }, [progress, reducedMotion, transition]);

  const selectTab = (next: MainTab) => {
    if (next === tab) return;
    const nextTransition = mainTabTransition(tab, next);
    const id = transitionId.current + 1;
    transitionId.current = id;
    progress.stopAnimation();
    progress.setValue(0);
    setTab(next);
    if (reducedMotion || pageWidth <= 0) {
      setTransition(null);
      progress.setValue(1);
      return;
    }
    setTransition(nextTransition);
    requestAnimationFrame(() => {
      if (transitionId.current !== id) return;
      Animated.timing(progress, {
        toValue: 1,
        duration: 190,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && transitionId.current === id) setTransition(null);
      });
    });
  };

  const measurePages = (event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width > 0 && width !== pageWidth) setPageWidth(width);
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}> 
      <View style={styles.viewport} onLayout={measurePages}>
        <TabPage id="chats" activeTab={tab} transition={transition} progress={progress} width={pageWidth}><ChatsScreen embedded /></TabPage>
        <TabPage id="servers" activeTab={tab} transition={transition} progress={progress} width={pageWidth}><ServersScreen /></TabPage>
        <TabPage id="profile" activeTab={tab} transition={transition} progress={progress} width={pageWidth}><ProfileScreen embedded /></TabPage>
        <TabPage id="settings" activeTab={tab} transition={transition} progress={progress} width={pageWidth}><SettingsScreen embedded /></TabPage>
      </View>
      <BottomNavigation selected={tab} onSelect={selectTab} />
    </View>
  );
}

function TabPage({ id, activeTab, transition, progress, width, children }: { id: MainTab; activeTab: MainTab; transition: ReturnType<typeof mainTabTransition> | null; progress: Animated.Value; width: number; children: ReactNode }) {
  const visible = id === activeTab || id === transition?.from;
  const direction = transition?.direction ?? 0;
  const translateX = transition?.from === id
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [0, -direction * width] })
    : transition?.to === id
      ? progress.interpolate({ inputRange: [0, 1], outputRange: [direction * width, 0] })
      : 0;
  return (
    <Animated.View
      pointerEvents={id === activeTab ? "auto" : "none"}
      style={[styles.page, !visible && styles.hiddenPage, { transform: [{ translateX }] }]}
      accessibilityElementsHidden={id !== activeTab}
      importantForAccessibility={id === activeTab ? "auto" : "no-hide-descendants"}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  viewport: { flex: 1, overflow: "hidden" },
  page: { ...StyleSheet.absoluteFill },
  hiddenPage: { display: "none" },
});
