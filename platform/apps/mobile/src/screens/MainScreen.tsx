import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, Easing, runOnJS, type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Screen } from "react-native-screens";

import { BottomNavigation } from "../components/BottomNavigation";
import { recordPerformance } from "../diagnostics/diagnostics";
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
  const progress = useSharedValue(1);
  const transitionId = useRef(0);
  const activeTab = useRef<MainTab>(tab);
  const requestedTab = useRef<{ from: MainTab; to: MainTab; startedAt: number } | null>(null);

  useLayoutEffect(() => {
    const request = requestedTab.current;
    if (!request || request.to !== tab) return;
    requestedTab.current = null;
    recordPerformance("tabResponse", performance.now() - request.startedAt, { from: request.from, to: request.to });
  }, [tab]);

  const finishTransition = useCallback((id: number) => {
    if (transitionId.current === id) setTransition(null);
  }, []);

  useLayoutEffect(() => {
    if (!transition) return;
    const id = transitionId.current;
    cancelAnimation(progress);
    progress.value = 0;
    if (reducedMotion || pageWidth <= 0) {
      progress.value = 1;
      setTransition(null);
      return;
    }
    // Start only after React commits the new from/to pages. Starting inside the
    // press handler races the old animated-style closure and causes a one-frame
    // jump on slower Android devices.
    progress.value = withTiming(1, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    }, (finished) => {
      if (finished) runOnJS(finishTransition)(id);
    });
    return () => cancelAnimation(progress);
  }, [finishTransition, pageWidth, progress, reducedMotion, transition]);

  const selectTab = useCallback((next: MainTab) => {
    const previous = activeTab.current;
    if (next === previous) return;
    requestedTab.current = { from: previous, to: next, startedAt: performance.now() };
    activeTab.current = next;
    const nextTransition = mainTabTransition(previous, next);
    const id = transitionId.current + 1;
    transitionId.current = id;
    setTab(next);
    if (reducedMotion || pageWidth <= 0) {
      setTransition(null);
      progress.value = 1;
      return;
    }
    setTransition(nextTransition);
  }, [pageWidth, progress, reducedMotion]);

  const measurePages = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width > 0) setPageWidth((current) => current === width ? current : width);
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}> 
      <View style={styles.viewport} onLayout={measurePages}>
        <TabPage id="chats" activeTab={tab} transition={transition} progress={progress} width={pageWidth}><ChatsScreen embedded active={tab === "chats"} /></TabPage>
        <TabPage id="servers" activeTab={tab} transition={transition} progress={progress} width={pageWidth}><ServersScreen /></TabPage>
        <TabPage id="profile" activeTab={tab} transition={transition} progress={progress} width={pageWidth}><ProfileScreen embedded active={tab === "profile"} /></TabPage>
        <TabPage id="settings" activeTab={tab} transition={transition} progress={progress} width={pageWidth}><SettingsScreen embedded /></TabPage>
      </View>
      <BottomNavigation selected={tab} onSelect={selectTab} />
    </View>
  );
}

function TabPage({ id, activeTab, transition, progress, width, children }: { id: MainTab; activeTab: MainTab; transition: ReturnType<typeof mainTabTransition> | null; progress: SharedValue<number>; width: number; children: ReactNode }) {
  const visible = id === activeTab || id === transition?.from;
  const direction = transition?.direction ?? 0;
  const animatedStyle = useAnimatedStyle(() => {
    const translateX = transition?.from === id
      ? -direction * width * progress.value
      : transition?.to === id
        ? direction * width * (1 - progress.value)
        : 0;
    return { transform: [{ translateX }] };
  }, [direction, id, transition, width]);
  return (
    <Animated.View
      pointerEvents={id === activeTab ? "auto" : "none"}
      style={[styles.page, !visible && styles.hiddenPage, animatedStyle]}
      accessibilityElementsHidden={id !== activeTab}
      importantForAccessibility={id === activeTab ? "auto" : "no-hide-descendants"}
    >
      <Screen activityState={2} shouldFreeze={!visible} style={styles.screenContent}>
        {children}
      </Screen>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  viewport: { flex: 1, overflow: "hidden" },
  page: { ...StyleSheet.absoluteFill },
  screenContent: { flex: 1 },
  // Keep native layout warm so distant tabs do not visibly build a frame after
  // the tap. Opacity zero avoids drawing while react-freeze stops hidden trees
  // from responding to realtime store updates.
  hiddenPage: { opacity: 0 },
});
