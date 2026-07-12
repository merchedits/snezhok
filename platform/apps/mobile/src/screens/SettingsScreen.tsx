import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ComponentProps, ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import type { AppSettings } from "@snezhok/contracts";

import { Avatar } from "../components/Avatar";
import { ScreenHeader } from "../components/ScreenHeader";
import { usePalette } from "../hooks/usePalette";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList } from "../types";
import { useAndroidUpdate } from "../updates/UpdateProvider";

type IconName = ComponentProps<typeof Ionicons>["name"];

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const palette = usePalette();
  const me = useAppStore((state) => state.me);
  const settings = useAppStore((state) => state.settings);
  const update = useAppStore((state) => state.updateSettings);
  const signOut = useAppStore((state) => state.signOut);
  const appUpdate = useAndroidUpdate();

  const patch = (value: Partial<AppSettings>) => void update(value).catch((error: unknown) => Alert.alert("Could not save settings", error instanceof Error ? error.message : "Try again."));

  return (
    <View style={[styles.screen, { backgroundColor: palette.surface }]}> 
      <ScreenHeader title="Settings" left={{ icon: "chevron-back", label: "Back", onPress: navigation.goBack }} />
      <ScrollView contentContainerStyle={styles.content}>
        {me ? (
          <View style={[styles.profile, { backgroundColor: palette.background }]}> 
            <Avatar uri={me.avatarUrl} label={me.displayName} color={me.avatarColor} size={64} online />
            <View style={styles.profileText}>
              <Text style={[styles.profileName, { color: palette.text }]}>{me.displayName}</Text>
              <Text style={[styles.username, { color: palette.secondaryText }]}>@{me.username}</Text>
              {me.statusText ? <Text numberOfLines={1} style={[styles.status, { color: palette.accent }]}>{me.statusText}</Text> : null}
            </View>
          </View>
        ) : null}

        <SettingsSection title="Appearance">
          <OptionRow icon="moon-outline" label="Theme" value={settings.theme}>
            <ChoiceStrip values={["system", "light", "dark"] as const} selected={settings.theme} onSelect={(theme) => patch({ theme })} />
          </OptionRow>
          <OptionRow icon="color-palette-outline" label="Accent" value={settings.accent}>
            <ChoiceStrip values={["blue", "green", "purple", "orange", "red"] as const} selected={settings.accent} onSelect={(accent) => patch({ accent })} compact />
          </OptionRow>
          <ToggleRow icon="contract-outline" label="Compact message spacing" value={settings.density === "compact"} onChange={(compact) => patch({ density: compact ? "compact" : "comfortable" })} />
          <ToggleRow icon="accessibility-outline" label="Reduce motion" value={settings.reducedMotion} onChange={(reducedMotion) => patch({ reducedMotion })} />
        </SettingsSection>

        <SettingsSection title="Data and storage">
          <OptionRow icon="cloud-upload-outline" label="Default upload quality" value={settings.defaultUploadQuality}>
            <ChoiceStrip values={["data-saver", "auto", "high", "original"] as const} selected={settings.defaultUploadQuality} onSelect={(defaultUploadQuality) => patch({ defaultUploadQuality })} />
          </OptionRow>
          <ToggleRow icon="wifi-outline" label="Auto-download on Wi-Fi" value={settings.autoDownloadWifi} onChange={(autoDownloadWifi) => patch({ autoDownloadWifi })} />
          <ToggleRow icon="cellular-outline" label="Auto-download on mobile data" value={settings.autoDownloadMobile} onChange={(autoDownloadMobile) => patch({ autoDownloadMobile })} />
          <ToggleRow icon="location-outline" label="Remove location from uploads" value={settings.stripMediaLocation} onChange={(stripMediaLocation) => patch({ stripMediaLocation })} />
        </SettingsSection>

        <SettingsSection title="Voice and video">
          <OptionRow icon="sparkles-outline" label="Noise suppression" value={settings.noiseSuppression}>
            <ChoiceStrip values={["off", "standard", "high"] as const} selected={settings.noiseSuppression} onSelect={(noiseSuppression) => patch({ noiseSuppression })} />
          </OptionRow>
          <ToggleRow icon="repeat-outline" label="Echo cancellation" value={settings.echoCancellation} onChange={(echoCancellation) => patch({ echoCancellation })} />
          <ToggleRow icon="options-outline" label="Automatic gain control" value={settings.autoGainControl} onChange={(autoGainControl) => patch({ autoGainControl })} />
          <ToggleRow icon="radio-button-on-outline" label="Push to talk" value={settings.pushToTalk} onChange={(pushToTalk) => patch({ pushToTalk })} />
        </SettingsSection>

        <SettingsSection title="Privacy">
          <ToggleRow icon="checkmark-done-outline" label="Read receipts" value={settings.readReceipts} onChange={(readReceipts) => patch({ readReceipts })} />
          <ToggleRow icon="time-outline" label="Show last seen" value={settings.showLastSeen} onChange={(showLastSeen) => patch({ showLastSeen })} />
        </SettingsSection>

        <SettingsSection title="Software update">
          <View style={[styles.updateStatus, { borderColor: palette.border }]}>
            <Ionicons name="phone-portrait-outline" size={20} color={palette.accent} />
            <View style={styles.updateCopy}>
              <Text style={[styles.optionLabel, { color: palette.text }]}>Snezhok {appUpdate.currentVersion}</Text>
              <Text style={[styles.updateMessage, { color: palette.secondaryText }]}>{appUpdate.message ?? `Build ${appUpdate.currentVersionCode} · Android update channel`}</Text>
            </View>
            {appUpdate.phase === "downloading" ? <Text style={[styles.optionValue, { color: palette.accent }]}>{Math.round(appUpdate.progress * 100)}%</Text> : null}
          </View>
          <ToggleRow icon="cloud-download-outline" label="Download updates automatically on Wi-Fi" value={appUpdate.autoUpdate} onChange={(enabled) => void appUpdate.setAutoUpdate(enabled)} />
          <Pressable
            disabled={appUpdate.phase === "checking" || appUpdate.phase === "downloading"}
            onPress={() => void (appUpdate.phase === "available" || appUpdate.phase === "error" ? appUpdate.downloadAndInstall() : appUpdate.phase === "ready" ? appUpdate.openInstaller() : appUpdate.checkForUpdate(true))}
            style={styles.updateButton}
          >
            <Text style={[styles.updateButtonText, { color: palette.accent }]}>{appUpdate.phase === "available" || appUpdate.phase === "error" ? "Download update" : appUpdate.phase === "ready" ? "Install update" : appUpdate.phase === "checking" ? "Checking…" : appUpdate.phase === "downloading" ? "Downloading…" : "Check for updates"}</Text>
          </Pressable>
          {appUpdate.manifest?.releaseNotes.length ? <View style={styles.releaseNotes}>{appUpdate.manifest.releaseNotes.map((note) => <Text key={note} style={[styles.releaseNote, { color: palette.secondaryText }]}>• {note}</Text>)}</View> : null}
        </SettingsSection>

        <Pressable onPress={() => Alert.alert("Sign out", "Remove this session from the device?", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: () => void signOut() }])} style={[styles.signOut, { backgroundColor: palette.background }]}> 
          <Text style={[styles.signOutText, { color: palette.danger }]}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const palette = usePalette();
  return <View><Text style={[styles.sectionTitle, { color: palette.secondaryText }]}>{title.toUpperCase()}</Text><View style={[styles.section, { backgroundColor: palette.background }]}>{children}</View></View>;
}

function OptionRow({ icon, label, value, children }: { icon: IconName; label: string; value: string; children: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={[styles.option, { borderColor: palette.border }]}> 
      <View style={styles.optionHeader}><Ionicons name={icon} size={20} color={palette.accent} /><Text style={[styles.optionLabel, { color: palette.text }]}>{label}</Text><Text style={[styles.optionValue, { color: palette.secondaryText }]}>{value}</Text></View>
      {children}
    </View>
  );
}

function ToggleRow({ icon, label, value, onChange }: { icon: IconName; label: string; value: boolean; onChange: (value: boolean) => void }) {
  const palette = usePalette();
  return (
    <View style={[styles.toggle, { borderColor: palette.border }]}> 
      <Ionicons name={icon} size={20} color={palette.accent} />
      <Text style={[styles.toggleLabel, { color: palette.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: palette.border, true: palette.accent }} />
    </View>
  );
}

function ChoiceStrip<T extends string>({ values, selected, onSelect, compact = false }: { values: readonly T[]; selected: T; onSelect: (value: T) => void; compact?: boolean }) {
  const palette = usePalette();
  return (
    <View style={styles.choices}>
      {values.map((value) => <Pressable key={value} onPress={() => onSelect(value)} style={[styles.choice, compact && styles.choiceCompact, { backgroundColor: selected === value ? palette.accentSoft : palette.surface, borderColor: selected === value ? palette.accent : palette.border }]}><Text numberOfLines={1} style={[styles.choiceText, { color: selected === value ? palette.accent : palette.secondaryText }]}>{value.replace("-", " ")}</Text></Pressable>)}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 30, gap: 20 },
  profile: { flexDirection: "row", alignItems: "center", padding: 18, gap: 14 },
  profileText: { flex: 1 },
  profileName: { fontSize: 20, fontWeight: "800" },
  username: { fontSize: 14, marginTop: 3 },
  status: { fontSize: 13, marginTop: 5 },
  sectionTitle: { fontSize: 12, fontWeight: "700", marginLeft: 16, marginBottom: 7 },
  section: { overflow: "hidden" },
  option: { paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  optionHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  optionLabel: { flex: 1, fontSize: 15 },
  optionValue: { fontSize: 13, textTransform: "capitalize" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 11, marginLeft: 31 },
  choice: { minWidth: 68, paddingHorizontal: 10, height: 30, borderWidth: 1, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  choiceCompact: { minWidth: 52 },
  choiceText: { fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
  toggle: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  toggleLabel: { flex: 1, fontSize: 15 },
  signOut: { height: 52, alignItems: "center", justifyContent: "center" },
  signOutText: { fontSize: 16, fontWeight: "600" },
  updateStatus: { minHeight: 60, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  updateCopy: { flex: 1, paddingVertical: 10 },
  updateMessage: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  updateButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  updateButtonText: { fontSize: 14, fontWeight: "800" },
  releaseNotes: { gap: 5, paddingHorizontal: 16, paddingBottom: 14 },
  releaseNote: { fontSize: 12, lineHeight: 17 },
});
