import { useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { BottomNavigation, type MainTab } from "../components/BottomNavigation";
import { usePalette } from "../hooks/usePalette";
import { useAppStore } from "../store/useAppStore";
import { ChatsScreen } from "./ChatsScreen";
import { ProfileScreen } from "./ProfileScreen";
import { ServersScreen } from "./ServersScreen";
import { SettingsScreen } from "./SettingsScreen";

export function MainScreen() {
  const palette = usePalette();
  const [tab, setTab] = useState<MainTab>("chats");
  const reducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const transition = useRef(new Animated.Value(1)).current;
  const selectTab = (next: MainTab) => {
    if (next === tab) return;
    transition.stopAnimation();
    if (reducedMotion) {
      setTab(next);
      transition.setValue(1);
      return;
    }
    Animated.timing(transition, { toValue: 0, duration: 85, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      setTab(next);
      transition.setValue(0);
      Animated.spring(transition, { toValue: 1, damping: 19, stiffness: 210, mass: 0.75, useNativeDriver: true }).start();
    });
  };
  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}> 
      <Animated.View style={[styles.content, { opacity: transition, transform: [{ translateY: transition.interpolate({ inputRange: [0, 1], outputRange: [5, 0] }) }] }]}>
        {tab === "chats" ? <ChatsScreen embedded /> : null}
        {tab === "servers" ? <ServersScreen /> : null}
        {tab === "profile" ? <ProfileScreen embedded /> : null}
        {tab === "settings" ? <SettingsScreen embedded /> : null}
      </Animated.View>
      <BottomNavigation selected={tab} onSelect={selectTab} />
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1 }, content: { flex: 1 } });
