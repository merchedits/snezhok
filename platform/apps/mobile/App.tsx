import NetInfo from "@react-native-community/netinfo";
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
import { CallSessionProvider } from "./src/calls/CallSessionProvider";
import { initializeDiagnostics, installGlobalErrorCapture, recordDiagnostic } from "./src/diagnostics/diagnostics";
import { ingestNativeDiagnostics, installNativeDiagnostics } from "./src/diagnostics/nativeDiagnostics";
import { flushMobileDiagnostics } from "./src/core/diagnostics/mobileDiagnosticDelivery";
import { usePalette } from "./src/hooks/usePalette";
import { useTranslation } from "./src/i18n";
import { useRealtime } from "./src/hooks/useRealtime";
import { navigationRef } from "./src/navigation/navigationRef";
import { flushPendingNotificationNavigation } from "./src/notifications/androidNotifications";
import { initializeMediaCache } from "./src/lib/mediaCache";
import { CallScreen } from "./src/screens/CallScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { ContactsScreen } from "./src/screens/ContactsScreen";
import { DiagnosticsScreen } from "./src/screens/DiagnosticsScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MainScreen } from "./src/screens/MainScreen";
import { PublicProfileScreen } from "./src/screens/ProfileScreen";
import { useAppStore } from "./src/store/useAppStore";
import type { RootStackParamList } from "./src/types";
import { AndroidUpdateProvider } from "./src/updates/UpdateProvider";
import { AppLockGate } from "./src/security/AppLockGate";

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
            <AppDialogProvider><CallSessionProvider><AppLockGate><AppRoot /></AppLockGate></CallSessionProvider></AppDialogProvider>
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
  const online = useAppStore((state) => state.online);
  const { language } = useTranslation();
  const palette = usePalette();

  useEffect(() => {
    void initializeDiagnostics().then(ingestNativeDiagnostics).catch(() => undefined);
    void initializeMediaCache().catch((error) => recordDiagnostic("warn", "media", "Could not configure media cache", { error }));
    const uninstallErrorCapture = installGlobalErrorCapture();
    void initialize().catch((error) => {
      // SecureStore, SQLite, and native transfer initialization all happen
      // before the store's network recovery boundary. A rejected startup
      // promise must unmount private UI and become a recoverable sign-in state,
      // never an unhandled rejection that terminates Hermes.
      recordDiagnostic("error", "lifecycle", "Application initialization failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      useAppStore.setState({ phase: "error", error: null });
    });
    const unsubscribe = NetInfo.addEventListener((state) => setOnline(Boolean(state.isConnected && state.isInternetReachable !== false)));
    return () => {
      unsubscribe();
      uninstallErrorCapture();
    };
  }, [initialize, setOnline]);

  useRealtime(phase === "ready");

  useEffect(() => {
    if (phase === "ready" && online) void flushMobileDiagnostics(language).catch(() => undefined);
  }, [language, online, phase]);

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
        <Stack.Screen name="Contacts" component={ContactsScreen} />
        <Stack.Screen name="Profile" component={PublicProfileScreen} />
        <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} />
        <Stack.Screen name="Call" component={CallScreen} options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function SafeChatScreen(props: ComponentProps<typeof ChatScreen>) {
  const { t } = useTranslation();
  const palette = usePalette();
  return <ChatErrorBoundary key={props.route.params.streamId} onBack={props.navigation.goBack} title={t("openChatFailed")} message={t("tryAgain")} backLabel={t("back")} colors={{ background: palette.background, text: palette.text, secondaryText: palette.secondaryText, button: palette.pop, buttonText: palette.onPop }}><ChatScreen {...props} /></ChatErrorBoundary>;
}

class ChatErrorBoundary extends Component<{ children: ReactNode; onBack: () => void; title: string; message: string; backLabel: string; colors: { background: string; text: string; secondaryText: string; button: string; buttonText: string } }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Message text can appear in component stacks and exception messages. Keep
    // production diagnostics useful without copying user-authored content into
    // Logcat or the client report buffer.
    recordDiagnostic("error", "crash", "Unhandled JavaScript error", {
      name: error.name || "Error",
      description: firstComponentName(info.componentStack),
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <SafeAreaView style={[styles.crash, { backgroundColor: this.props.colors.background }]}>
        <Text style={[styles.crashTitle, { color: this.props.colors.text }]}>{this.props.title}</Text>
        <Text style={[styles.crashText, { color: this.props.colors.secondaryText }]}>{this.props.message}</Text>
        <Pressable onPress={this.props.onBack} style={[styles.crashButton, { backgroundColor: this.props.colors.button }]}><Text style={[styles.crashButtonText, { color: this.props.colors.buttonText }]}>{this.props.backLabel}</Text></Pressable>
      </SafeAreaView>
    );
  }
}

function firstComponentName(componentStack?: string | null): string {
  return componentStack?.match(/\bat ([A-Za-z][A-Za-z0-9_]*)\b/)?.[1] ?? "UnknownComponent";
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  crash: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  crashTitle: { fontSize: 20, fontWeight: "800" },
  crashText: { fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8 },
  crashButton: { minWidth: 120, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", marginTop: 20 },
  crashButtonText: { fontSize: 15, fontWeight: "800" },
});
