import * as LocalAuthentication from "expo-local-authentication";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "../components/AppIcon";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { shouldConcealApp } from "./appLockPolicy";
import { loadAppLockEnabled, useAppLockEnabled } from "./localAppLock";

export function AppLockGate({ children }: { children: ReactNode }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const phase = useAppStore((state) => state.phase);
  const signOut = useAppStore((state) => state.signOut);
  const enabled = useAppLockEnabled();
  const [locked, setLocked] = useState(false);
  const [failure, setFailure] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const promptActive = useRef(false);
  const initialCheckDone = useRef(false);

  const unlock = useCallback(async () => {
    if (promptActive.current) return;
    promptActive.current = true;
    setFailure(false);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t("unlockSnezhok"),
        promptDescription: t("appLockDescription"),
        cancelLabel: t("cancel"),
        biometricsSecurityLevel: "strong",
        disableDeviceFallback: false,
      });
      if (result.success) setLocked(false);
      else setFailure(true);
    } catch { setFailure(true); }
    finally { promptActive.current = false; }
  }, [t]);

  useEffect(() => { void loadAppLockEnabled().finally(() => setHydrated(true)); }, []);
  useEffect(() => {
    if (!hydrated || phase !== "ready") { if (phase !== "ready") setLocked(false); return; }
    if (!initialCheckDone.current) {
      initialCheckDone.current = true;
      if (enabled) { setLocked(true); void unlock(); }
      return;
    }
    if (!enabled) setLocked(false);
  }, [enabled, hydrated, phase, unlock]);
  useEffect(() => AppState.addEventListener("change", (next) => {
    if (!enabled || phase !== "ready") return;
    if (shouldConcealApp(enabled, true, next)) setLocked(true);
    else if (next === "active" && locked) void unlock();
  }).remove, [enabled, locked, phase, unlock]);

  return <View style={styles.root}>
    {children}
    {locked ? <View accessibilityViewIsModal style={[styles.cover, { backgroundColor: palette.background }]}>
      <AppIcon name="lock-closed-outline" size={48} color={palette.accent} />
      <Text style={[styles.title, { color: palette.text }]}>{t("snezhokLocked")}</Text>
      <Text style={[styles.body, { color: failure ? palette.danger : palette.secondaryText }]}>{failure ? t("appLockTryAgain") : t("appLockDescription")}</Text>
      <Pressable accessibilityRole="button" onPress={() => void unlock()} style={[styles.unlock, { backgroundColor: palette.accent }]}><Text style={styles.unlockText}>{t("unlock")}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.signOut}><Text style={{ color: palette.secondaryText }}>{t("signOut")}</Text></Pressable>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, cover: { ...StyleSheet.absoluteFill, zIndex: 10_000, alignItems: "center", justifyContent: "center", padding: 32 },
  title: { marginTop: 18, fontSize: 24, lineHeight: 30, fontWeight: "800" }, body: { marginTop: 8, maxWidth: 320, textAlign: "center", fontSize: 14, lineHeight: 20 },
  unlock: { marginTop: 24, minWidth: 180, minHeight: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 }, unlockText: { color: "white", fontSize: 15, fontWeight: "800" },
  signOut: { marginTop: 14, minHeight: 44, justifyContent: "center", paddingHorizontal: 18 },
});
