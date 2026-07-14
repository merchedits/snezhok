import { AppIcon, type AppIconName } from "../components/AppIcon";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import type { AppSettings } from "@snezhok/contracts";

import { ScreenHeader } from "../components/ScreenHeader";
import { usePalette } from "../hooks/usePalette";
import { optionLabel, useTranslation } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList } from "../types";
import { useAndroidUpdate } from "../updates/UpdateProvider";

type IconName = AppIconName;

export function SettingsScreen({ embedded = false }: { embedded?: boolean }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const palette = usePalette();
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const update = useAppStore((state) => state.updateSettings);
  const signOut = useAppStore((state) => state.signOut);
  const appUpdate = useAndroidUpdate();
  const patch = (value: Partial<AppSettings>) => void update(value).catch((error: unknown) => Alert.alert(t("saveFailed"), error instanceof Error ? error.message : t("tryAgain")));

  return (
    <View style={[styles.screen, { backgroundColor: palette.surface }]}> 
      <ScreenHeader title={t("settings")} {...(!embedded ? { left: { icon: "chevron-back" as const, label: t("back"), onPress: navigation.goBack } } : {})} />
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSection title={t("appearance")}>
          <OptionRow icon="language-outline" label={t("language")} value={settings.language === "ru" ? t("russian") : t("english")}><ChoiceStrip values={["ru", "en"] as const} selected={settings.language} onSelect={(language) => patch({ language })} /></OptionRow>
          <OptionRow icon="moon-outline" label={t("theme")} value={optionLabel(settings.language, settings.theme)}><ChoiceStrip values={["system", "light", "dark"] as const} selected={settings.theme} onSelect={(theme) => patch({ theme })} /></OptionRow>
          <OptionRow icon="color-palette-outline" label={t("accent")} value={optionLabel(settings.language, settings.accent)}><ChoiceStrip values={["blue", "green", "purple", "orange", "red"] as const} selected={settings.accent} onSelect={(accent) => patch({ accent })} compact /></OptionRow>
          <ToggleRow icon="contract-outline" label={t("compactSpacing")} value={settings.density === "compact"} onChange={(compact) => patch({ density: compact ? "compact" : "comfortable" })} />
          <ToggleRow icon="accessibility-outline" label={t("reduceMotion")} value={settings.reducedMotion} onChange={(reducedMotion) => patch({ reducedMotion })} />
        </SettingsSection>

        <SettingsSection title={t("dataStorage")}>
          <OptionRow icon="cloud-upload-outline" label={t("uploadQuality")} value={optionLabel(settings.language, settings.defaultUploadQuality)}><ChoiceStrip values={["data-saver", "auto", "high", "original"] as const} selected={settings.defaultUploadQuality} onSelect={(defaultUploadQuality) => patch({ defaultUploadQuality })} /></OptionRow>
          <ToggleRow icon="wifi-outline" label={t("autoWifi")} value={settings.autoDownloadWifi} onChange={(autoDownloadWifi) => patch({ autoDownloadWifi })} />
          <ToggleRow icon="cellular-outline" label={t("autoMobile")} value={settings.autoDownloadMobile} onChange={(autoDownloadMobile) => patch({ autoDownloadMobile })} />
          <ToggleRow icon="location-outline" label={t("removeLocation")} value={settings.stripMediaLocation} onChange={(stripMediaLocation) => patch({ stripMediaLocation })} />
        </SettingsSection>

        <SettingsSection title={t("voiceVideo")}>
          <OptionRow icon="mic-outline" label={t("microphone")} value={microphoneLabel(settings.microphoneMode, t)}>
            <ChoiceStrip values={["system", "phone", "speakerphone"] as const} selected={settings.microphoneMode} onSelect={(microphoneMode) => patch({ microphoneMode })} labelFor={(value) => microphoneLabel(value, t)} />
            {settings.microphoneMode === "speakerphone" ? <Text style={[styles.optionHint, { color: palette.secondaryText }]}>{t("microphoneSpeakerphoneHint")}</Text> : null}
          </OptionRow>
          <OptionRow icon="sparkles-outline" label={t("noiseSuppression")} value={optionLabel(settings.language, settings.noiseSuppression)}><ChoiceStrip values={["off", "standard", "high"] as const} selected={settings.noiseSuppression} onSelect={(noiseSuppression) => patch({ noiseSuppression })} /></OptionRow>
          <ToggleRow icon="repeat-outline" label={t("echoCancellation")} value={settings.echoCancellation} onChange={(echoCancellation) => patch({ echoCancellation })} />
          <ToggleRow icon="options-outline" label={t("autoGain")} value={settings.autoGainControl} onChange={(autoGainControl) => patch({ autoGainControl })} />
          <ToggleRow icon="radio-button-on-outline" label={t("pushToTalk")} value={settings.pushToTalk} onChange={(pushToTalk) => patch({ pushToTalk })} />
        </SettingsSection>

        <SettingsSection title={t("privacy")}>
          <ToggleRow icon="checkmark-done-outline" label={t("readReceipts")} value={settings.readReceipts} onChange={(readReceipts) => patch({ readReceipts })} />
          <ToggleRow icon="time-outline" label={t("showLastSeen")} value={settings.showLastSeen} onChange={(showLastSeen) => patch({ showLastSeen })} />
        </SettingsSection>

        <SettingsSection title={t("softwareUpdate")}>
          <View style={[styles.updateStatus, { borderColor: palette.border }]}><AppIcon name="phone-portrait-outline" size={20} color={palette.accent} /><View style={styles.updateCopy}><Text style={[styles.optionLabel, { color: palette.text }]}>Snezhok {appUpdate.currentVersion}</Text><Text style={[styles.updateMessage, { color: palette.secondaryText }]}>{appUpdate.message ?? t("buildChannel", { build: appUpdate.currentVersionCode })}</Text></View>{appUpdate.phase === "downloading" ? <Text style={[styles.optionValue, { color: palette.accent }]}>{Math.round(appUpdate.progress * 100)}%</Text> : null}</View>
          <ToggleRow icon="cloud-download-outline" label={t("autoUpdateWifi")} value={appUpdate.autoUpdate} onChange={(enabled) => void appUpdate.setAutoUpdate(enabled)} />
          <Pressable disabled={appUpdate.phase === "checking" || appUpdate.phase === "downloading"} onPress={() => void (appUpdate.phase === "available" || appUpdate.phase === "error" ? appUpdate.downloadAndInstall() : appUpdate.phase === "ready" ? appUpdate.openInstaller() : appUpdate.checkForUpdate(true))} style={styles.updateButton}><Text style={[styles.updateButtonText, { color: palette.accent }]}>{appUpdate.phase === "available" || appUpdate.phase === "error" ? t("downloadUpdate") : appUpdate.phase === "ready" ? t("installUpdate") : appUpdate.phase === "checking" ? t("checking") : appUpdate.phase === "downloading" ? t("downloading") : t("checkUpdates")}</Text></Pressable>
          {appUpdate.manifest?.releaseNotes.length ? <View style={styles.releaseNotes}>{appUpdate.manifest.releaseNotes.map((note) => <Text key={note} style={[styles.releaseNote, { color: palette.secondaryText }]}>• {note}</Text>)}</View> : null}
        </SettingsSection>

        <Pressable onPress={() => Alert.alert(t("signOut"), t("signOutQuestion"), [{ text: t("cancel"), style: "cancel" }, { text: t("signOut"), style: "destructive", onPress: () => void signOut() }])} style={[styles.signOut, { backgroundColor: palette.background }]}><Text style={[styles.signOutText, { color: palette.danger }]}>{t("signOut")}</Text></Pressable>
      </ScrollView>
    </View>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) { const palette = usePalette(); return <View><Text style={[styles.sectionTitle, { color: palette.secondaryText }]}>{title}</Text><View style={[styles.section, { backgroundColor: palette.background }]}>{children}</View></View>; }
function OptionRow({ icon, label, value, children }: { icon: IconName; label: string; value: string; children: ReactNode }) { const palette = usePalette(); return <View style={[styles.option, { borderColor: palette.border }]}><View style={styles.optionHeader}><AppIcon name={icon} size={20} color={palette.accent} /><Text style={[styles.optionLabel, { color: palette.text }]}>{label}</Text><Text style={[styles.optionValue, { color: palette.secondaryText }]}>{value}</Text></View>{children}</View>; }
function ToggleRow({ icon, label, value, onChange }: { icon: IconName; label: string; value: boolean; onChange: (value: boolean) => void }) { const palette = usePalette(); return <View style={[styles.toggle, { borderColor: palette.border }]}><AppIcon name={icon} size={20} color={palette.accent} /><Text style={[styles.toggleLabel, { color: palette.text }]}>{label}</Text><Switch value={value} onValueChange={onChange} trackColor={{ false: palette.border, true: palette.accent }} /></View>; }
function ChoiceStrip<T extends string>({ values, selected, onSelect, compact = false, labelFor }: { values: readonly T[]; selected: T; onSelect: (value: T) => void; compact?: boolean; labelFor?: (value: T) => string }) { const palette = usePalette(); const { language } = useTranslation(); return <View style={styles.choices}>{values.map((value) => <Pressable key={value} onPress={() => onSelect(value)} style={[styles.choice, compact && styles.choiceCompact, { backgroundColor: selected === value ? palette.accentSoft : palette.surface, borderColor: selected === value ? palette.accent : palette.border }]}><Text numberOfLines={1} style={[styles.choiceText, { color: selected === value ? palette.accent : palette.secondaryText }]}>{labelFor?.(value) ?? (value === "ru" ? "Русский" : value === "en" ? "English" : optionLabel(language, value))}</Text></Pressable>)}</View>; }

function microphoneLabel(mode: AppSettings["microphoneMode"], t: ReturnType<typeof useTranslation>["t"]): string {
  if (mode === "phone") return t("microphonePhone");
  if (mode === "speakerphone") return t("microphoneSpeakerphone");
  return t("microphoneSystem");
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { paddingBottom: 30, gap: 20 }, sectionTitle: { fontSize: 12, fontWeight: "700", marginLeft: 16, marginBottom: 7 }, section: { overflow: "hidden" },
  option: { paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth }, optionHeader: { flexDirection: "row", alignItems: "center", gap: 11 }, optionLabel: { flex: 1, fontSize: 15 }, optionValue: { fontSize: 13 }, optionHint: { fontSize: 12, lineHeight: 17, marginTop: 8, marginLeft: 31 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 11, marginLeft: 31 }, choice: { minWidth: 68, paddingHorizontal: 10, height: 30, borderWidth: 1, borderRadius: 8, alignItems: "center", justifyContent: "center" }, choiceCompact: { minWidth: 52 }, choiceText: { fontSize: 12, fontWeight: "600" },
  toggle: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 11, borderBottomWidth: StyleSheet.hairlineWidth }, toggleLabel: { flex: 1, fontSize: 15 }, signOut: { height: 52, alignItems: "center", justifyContent: "center" }, signOutText: { fontSize: 16, fontWeight: "600" },
  updateStatus: { minHeight: 60, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 11, borderBottomWidth: StyleSheet.hairlineWidth }, updateCopy: { flex: 1, paddingVertical: 10 }, updateMessage: { fontSize: 12, lineHeight: 17, marginTop: 2 }, updateButton: { minHeight: 48, alignItems: "center", justifyContent: "center" }, updateButtonText: { fontSize: 14, fontWeight: "800" }, releaseNotes: { gap: 5, paddingHorizontal: 16, paddingBottom: 14 }, releaseNote: { fontSize: 12, lineHeight: 17 },
});
