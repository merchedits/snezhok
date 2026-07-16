import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Component, type ComponentProps, type ErrorInfo, type ReactNode, useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { enableFreeze } from "react-native-screens";
import { StatusBar } from "expo-status-bar";

import { OfflineBar } from "./src/components/OfflineBar";
import { AppDialogProvider } from "./src/components/AppDialogProvider";
import { initializeDiagnostics, installGlobalErrorCapture, recordDiagnostic } from "./src/diagnostics/diagnostics";
import { ingestNativeDiagnostics, installNativeDiagnostics } from "./src/diagnostics/nativeDiagnostics";
import { usePalette } from "./src/hooks/usePalette";
import { useTranslation } from "./src/i18n";
import { useRealtime } from "./src/hooks/useRealtime";
import { navigationRef } from "./src/navigation/navigationRef";
import { flushPendingNotificationNavigation } from "./src/notifications/androidNotifications";
import { initializeMediaCache } from "./src/lib/mediaCache";
import { CallScreen } from "./src/screens/CallScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { DiagnosticsScreen } from "./src/screens/DiagnosticsScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MainScreen } from "./src/screens/MainScreen";
import { PublicProfileScreen } from "./src/screens/ProfileScreen";
import { useAppStore } from "./src/store/useAppStore";
import type { RootStackParamList } from "./src/types";
import { AndroidUpdateProvider } from "./src/updates/UpdateProvider";

const Stack = createNativeStackNavigator<RootStackParamList>();

// Native-screen freezing prevents the four-tab home tree from rerendering
// behind an open chat, profile, or call. This is especially visible on low-end
// devices while message and recording events arrive frequently.
enableFreeze(true);
installNativeDiagnostics();

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <AndroidUpdateProvider>
            <AppDialogProvider><AppRoot /></AppDialogProvider>
          </AndroidUpdateProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function AppRoot() {
  const phase = useAppStore((state) => state.phase);
  const initialize = useAppStore((state) => state.initialize);
  const setOnline = useAppStore((state) => state.setOnline);
  const palette = usePalette();

  useEffect(() => {
    void initializeDiagnostics().then(ingestNativeDiagnostics).catch(() => undefined);
    void initializeMediaCache().catch((error) => recordDiagnostic("warn", "media", "Could not configure media cache", { error }));
    const uninstallErrorCapture = installGlobalErrorCapture();
    void initialize();
    const unsubscribe = NetInfo.addEventListener((state) => setOnline(Boolean(state.isConnected && state.isInternetReachable !== false)));
    return () => {
      unsubscribe();
      uninstallErrorCapture();
    };
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
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        recordDiagnostic("info", "navigation", "Navigation ready", { route: navigationRef.getCurrentRoute()?.name ?? "unknown" });
        flushPendingNotificationNavigation();
      }}
      onStateChange={() => recordDiagnostic("debug", "navigation", "Route changed", { route: navigationRef.getCurrentRoute()?.name ?? "unknown" })}
      theme={navigationTheme}
    >
      <StatusBar style={palette.dark ? "light" : "dark"} />
      <OfflineBar />
      <Stack.Navigator screenOptions={{ headerShown: false, animation: "slide_from_right", freezeOnBlur: true }}>
        <Stack.Screen name="Main" component={MainScreen} />
        <Stack.Screen name="Chat" component={SafeChatScreen} />
        <Stack.Screen name="Profile" component={PublicProfileScreen} />
        <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} />
        <Stack.Screen name="Call" component={CallScreen} options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function SafeChatScreen(props: ComponentProps<typeof ChatScreen>) {
  const { t } = useTranslation();
  return <ChatErrorBoundary key={props.route.params.streamId} onBack={props.navigation.goBack} title={t("openChatFailed")} message={t("tryAgain")} backLabel={t("back")}><ChatScreen {...props} /></ChatErrorBoundary>;
}

class ChatErrorBoundary extends Component<{ children: ReactNode; onBack: () => void; title: string; message: string; backLabel: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Chat screen failed", error, info.componentStack);
    recordDiagnostic("error", "crash", "Chat screen failed", { error, componentStack: info.componentStack });
    void AsyncStorage.setItem("@snezhok/last-chat-error/v1", JSON.stringify({ message: error.message, stack: error.stack, componentStack: info.componentStack, recordedAt: new Date().toISOString() })).catch(() => undefined);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <SafeAreaView style={styles.crash}>
        <Text style={styles.crashTitle}>{this.props.title}</Text>
        <Text style={styles.crashText}>{this.props.message}</Text>
        <Pressable onPress={this.props.onBack} style={styles.crashButton}><Text style={styles.crashButtonText}>{this.props.backLabel}</Text></Pressable>
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
