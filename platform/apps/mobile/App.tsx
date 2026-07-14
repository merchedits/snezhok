import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Component, type ComponentProps, type ErrorInfo, type ReactNode, useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { OfflineBar } from "./src/components/OfflineBar";
import { usePalette } from "./src/hooks/usePalette";
import { useRealtime } from "./src/hooks/useRealtime";
import { navigationRef } from "./src/navigation/navigationRef";
import { flushPendingNotificationNavigation } from "./src/notifications/androidNotifications";
import { CallScreen } from "./src/screens/CallScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MainScreen } from "./src/screens/MainScreen";
import { PublicProfileScreen } from "./src/screens/ProfileScreen";
import { useAppStore } from "./src/store/useAppStore";
import type { RootStackParamList } from "./src/types";
import { AndroidUpdateProvider } from "./src/updates/UpdateProvider";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <AndroidUpdateProvider>
          <AppRoot />
        </AndroidUpdateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
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
    <NavigationContainer ref={navigationRef} onReady={flushPendingNotificationNavigation} theme={navigationTheme}>
      <StatusBar style={palette.dark ? "light" : "dark"} />
      <OfflineBar />
      <Stack.Navigator screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
        <Stack.Screen name="Main" component={MainScreen} />
        <Stack.Screen name="Chat" component={SafeChatScreen} />
        <Stack.Screen name="Profile" component={PublicProfileScreen} />
        <Stack.Screen name="Call" component={CallScreen} options={{ presentation: "fullScreenModal", animation: "fade" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function SafeChatScreen(props: ComponentProps<typeof ChatScreen>) {
  return <ChatErrorBoundary key={props.route.params.streamId} onBack={props.navigation.goBack}><ChatScreen {...props} /></ChatErrorBoundary>;
}

class ChatErrorBoundary extends Component<{ children: ReactNode; onBack: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Chat screen failed", error, info.componentStack);
    void AsyncStorage.setItem("@snezhok/last-chat-error/v1", JSON.stringify({ message: error.message, stack: error.stack, componentStack: info.componentStack, recordedAt: new Date().toISOString() })).catch(() => undefined);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <SafeAreaView style={styles.crash}>
        <Text style={styles.crashTitle}>Не удалось открыть чат</Text>
        <Text style={styles.crashText}>Ошибка сохранена в журнале. Вернитесь назад и попробуйте снова.</Text>
        <Pressable onPress={this.props.onBack} style={styles.crashButton}><Text style={styles.crashButtonText}>Назад</Text></Pressable>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  crash: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "#0b1422" },
  crashTitle: { color: "#f4f7fb", fontSize: 20, fontWeight: "800" },
  crashText: { color: "#96a5b8", fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8 },
  crashButton: { minWidth: 120, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 20, backgroundColor: "#35b9ef" },
  crashButtonText: { color: "white", fontSize: 15, fontWeight: "800" },
});
