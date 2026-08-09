import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { ScreenHeader } from "../components/ScreenHeader";
import { useAppDialog } from "../components/AppDialogProvider";
import { clearDiagnostics, diagnosticReport, recordDiagnostic, type DiagnosticReport } from "../diagnostics/diagnostics";
import { measureFramePacing } from "../diagnostics/framePacing";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { api, type DiagnosticHealth } from "../lib/api";
import { userFacingError } from "../lib/userFacingError";
import type { RootStackParamList } from "../types";

export function DiagnosticsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, "Diagnostics">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t, language } = useTranslation();
  const showDialog = useAppDialog();
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [health, setHealth] = useState<DiagnosticHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextReport, nextHealth] = await Promise.all([diagnosticReport(language), api.diagnosticHealth()]);
      setReport(nextReport);
      setHealth(nextHealth);
    } catch (error) {
      setReport(await diagnosticReport(language));
      showDialog(t("diagnosticsUnavailable"), userFacingError(error, t));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [language]);

  const counts = useMemo(() => {
    const entries = report?.events ?? [];
    return {
      errors: entries.filter((event) => event.level === "error").length,
      warnings: entries.filter((event) => event.level === "warn").length,
      slow: entries.filter((event) => event.category === "performance" && event.context?.passed === false).length,
    };
  }, [report]);

  const copyReport = async () => {
    const next = await diagnosticReport(language);
    await Clipboard.setStringAsync(JSON.stringify(next, null, 2));
    showDialog(t("diagnosticsCopied"), t("diagnosticsAnonymized"));
  };

  const sendReport = async () => {
    if (sending) return;
    setSending(true);
    try {
      const next = await diagnosticReport(language);
      const result = await api.sendDiagnosticReport(next);
      showDialog(t("diagnosticsSent"), t("diagnosticsReference", { id: result.requestId }));
    } catch (error) {
      showDialog(t("requestFailed"), userFacingError(error, t));
    } finally {
      setSending(false);
    }
  };

  const clear = () => showDialog(t("clearDiagnostics"), t("clearDiagnosticsQuestion"), [
    { text: t("cancel"), style: "cancel" },
    { text: t("clear"), style: "destructive", onPress: () => void clearDiagnostics().then(() => refresh()) },
  ]);

  const runBenchmark = async () => {
    if (benchmarking) return;
    setBenchmarking(true);
    const result = await measureFramePacing();
    recordDiagnostic(result.averageFps >= 50 && result.p95FrameMs <= 25 ? "info" : "warn", "performance", "framePacing", { ...result });
    setReport(await diagnosticReport(language));
    setBenchmarking(false);
    showDialog(t("performanceTestComplete"), t("performanceTestResult", { fps: result.averageFps, frame: result.p95FrameMs, jank: result.jankyFrames }));
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScreenHeader title={t("diagnostics")} left={{ icon: "chevron-back", label: t("back"), onPress: navigation.goBack }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 20, 32) }]} showsVerticalScrollIndicator={false}>
        {loading && !report ? <ActivityIndicator color={palette.accent} /> : null}
        <View style={[styles.card, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
          <Metric label={t("serverStatus")} value={health?.status === "ok" ? t("online") : t("unavailable")} color={health?.status === "ok" ? palette.success : palette.danger} />
          <Metric label={t("databaseLatency")} value={health ? `${health.databaseLatencyMs} ms` : "—"} color={palette.text} />
          <Metric label={t("diagnosticEvents")} value={String(report?.events.length ?? 0)} color={palette.text} />
          <Metric label={t("diagnosticProblems")} value={`${counts.errors} / ${counts.warnings} / ${counts.slow}`} color={counts.errors ? palette.danger : palette.secondaryText} />
        </View>

        <Text style={[styles.hint, { color: palette.secondaryText }]}>{t("diagnosticsAnonymized")}</Text>

        <View style={styles.actions}>
          <Action label={t("refresh")} onPress={() => void refresh()} background={palette.accentSoft} color={palette.accent} />
          <Action label={t("copyReport")} onPress={() => void copyReport()} background={palette.accentSoft} color={palette.accent} />
          <Action label={sending ? t("sending") : t("sendReport")} disabled={sending} onPress={() => void sendReport()} background={palette.accent} color="white" />
          <Action label={benchmarking ? t("testing") : t("runPerformanceTest")} disabled={benchmarking} onPress={() => void runBenchmark()} background={palette.accentSoft} color={palette.accent} />
          <Action label={t("clear")} onPress={clear} background="rgba(227,77,89,0.14)" color={palette.danger} />
        </View>

        <Text style={[styles.sectionTitle, { color: palette.secondaryText }]}>{t("recentDiagnosticEvents")}</Text>
        <View style={[styles.card, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
          {(report?.events.slice(-30).reverse() ?? []).map((event, index) => (
            <View key={`${event.at}-${index}`} style={[styles.event, index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <View style={styles.eventHeader}><Text style={[styles.eventCategory, { color: levelColor(event.level, palette) }]}>{event.category}</Text><Text style={[styles.eventTime, { color: palette.faintText }]}>{new Date(event.at).toLocaleTimeString()}</Text></View>
              <Text style={[styles.eventMessage, { color: palette.text }]}>{event.message}{event.durationMs !== undefined ? ` · ${event.durationMs} ms` : ""}</Text>
            </View>
          ))}
          {!report?.events.length ? <Text style={[styles.empty, { color: palette.secondaryText }]}>{t("noDiagnosticEvents")}</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, { color }]}>{value}</Text></View>;
}

function Action({ label, onPress, background, color, disabled = false }: { label: string; onPress: () => void; background: string; color: string; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: background, opacity: disabled ? 0.5 : pressed ? 0.68 : 1 }]}><Text style={[styles.actionText, { color }]}>{label}</Text></Pressable>;
}

function levelColor(level: "debug" | "info" | "warn" | "error", palette: ReturnType<typeof usePalette>): string {
  if (level === "error") return palette.danger;
  if (level === "warn") return palette.warning;
  if (level === "info") return palette.accent;
  return palette.secondaryText;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 14, gap: 14 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: "hidden" },
  metric: { minHeight: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  metricLabel: { color: "#8f9baa", fontSize: 14, flex: 1 },
  metricValue: { fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  hint: { fontSize: 12, lineHeight: 17, paddingHorizontal: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { minHeight: 42, borderRadius: 14, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 14, fontWeight: "700" },
  sectionTitle: { marginTop: 5, marginHorizontal: 4, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  event: { paddingHorizontal: 14, paddingVertical: 11, gap: 4 },
  eventHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  eventCategory: { fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  eventTime: { fontSize: 11, fontVariant: ["tabular-nums"] },
  eventMessage: { fontSize: 13, lineHeight: 18 },
  empty: { padding: 20, textAlign: "center", fontSize: 13 },
});
