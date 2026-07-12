import NetInfo from "@react-native-community/netinfo";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { OfflineBar } from "./src/components/OfflineBar";
import { usePalette } from "./src/hooks/usePalette";
import { useRealtime } from "./src/hooks/useRealtime";
import { CallScreen } from "./src/screens/CallScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { ChatsScreen } from "./src/screens/ChatsScreen";
import { ContactsScreen } from "./src/screens/ContactsScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { useAppStore } from "./src/store/useAppStore";
import type { RootStackParamList } from "./src/types";
import { AndroidUpdateProvider } from "./src/updates/UpdateProvider";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <AndroidUpdateProvider>
        <AppRoot />
      </AndroidUpdateProvider>
    </SafeAreaProvider>
  );
}

function AppRoot() {
  const phase = useAppStore((state) => state.phase);
  const initialize = useAppStore((state) => state.initialize);
  const setOnline = useAppStore((state) => state.setOnline);
  const palette = usePalette();

  useEffect(() => {
    void initialize();
    const unsubscribe = NetInfo.addEventListener((state) => setOnline(Boolean(state.isConnected && state.isInternetReachable !== false)));
    return unsubscribe;
  }, [initialize, setOnline]);

  useRealtime(phase === "ready");

  if (phase === "booting") {
    return (
      <View style={[styles.loader, { backgroundColor: palette.background }]}>
        <ActivityIndicator size="large" color={palette.accent} />
      </View>
    );
  }
  if (phase === "signed-out" || phase === "error") return <LoginScreen />;

  const base = palette.dark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: palette.accent,
      background: palette.background,
      card: palette.background,
      text: palette.text,
      border: palette.border,
      notification: palette.danger,
    },
  };

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style={palette.dark ? "light" : "dark"} />
      <OfflineBar />
      <Stack.Navigator screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
        <Stack.Screen name="Main" component={ChatsScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
        <Stack.Screen name="Contacts" component={ContactsScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Call" component={CallScreen} options={{ presentation: "fullScreenModal", animation: "fade" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({ loader: { flex: 1, alignItems: "center", justifyContent: "center" } });
