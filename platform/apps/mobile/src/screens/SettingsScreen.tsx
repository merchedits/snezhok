import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppSettings } from "@snezhok/contracts";

import { ScreenHeader } from "../components/ScreenHeader";
import { useAppDialog } from "../components/AppDialogProvider";
import { AccountPrivacyModal, type AccountPrivacyPage } from "../components/management/AccountPrivacyModal";
import { MentionsModal } from "../components/management/MentionsModal";
import { GlobalAdminModal } from "../components/management/GlobalAdminModal";
import { NotificationPreferencesModal } from "../components/management/NotificationPreferencesModal";
import {
  SettingsCard,
  SettingsChoiceSheet,
  type SettingsChoiceOption,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
} from "../components/settings/SettingsGroup";
import { usePalette } from "../hooks/usePalette";
import { optionLabel, useTranslation } from "../i18n";
import { clearMediaCache, currentMediaCacheBytes, formatStorageBytes, mediaCacheLimit, MEDIA_CACHE_LIMITS_MB, setMediaCacheLimit, type MediaCacheLimitMb } from "../lib/mediaCache";
import { userFacingError } from "../lib/userFacingError";
import { productCopy } from "../lib/productCopy";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList } from "../types";
import { useAndroidUpdate } from "../updates/UpdateProvider";

type ChoiceSetting = "language" | "theme" | "accent" | "fontScale" | "bubbleRadius" | "defaultUploadQuality" | "microphoneMode" | "noiseSuppression" | "callAudioRoute" | "callQuality" | "screenShareQuality" | "mediaCacheLimit";

interface ChoiceRequest {
  key: ChoiceSetting;
  title: string;
  selected: string;
  options: SettingsChoiceOption[];
}

const accentColors: Record<AppSettings["accent"], string> = {
  blue: "#3F6FE5",
  green: "#39A86B",
  purple: "#8A63D2",
  orange: "#E77C33",
  red: "#D94A57",
};

export function SettingsScreen({ embedded = false }: { embedded?: boolean }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const settings = useAppStore((state) => state.settings);
  const isAdmin = useAppStore((state) => state.me?.isAdmin === true);
  const update = useAppStore((state) => state.updateSettings);
  const signOut = useAppStore((state) => state.signOut);
  const appUpdate = useAndroidUpdate();
  const [choice, setChoice] = useState<ChoiceRequest | null>(null);
  const [cacheLimit, setCacheLimitState] = useState<MediaCacheLimitMb>(256);
  const [cacheBytes, setCacheBytes] = useState(0);
  const [accountPage, setAccountPage] = useState<AccountPrivacyPage | null>(null);
  const [notificationPreferences, setNotificationPreferences] = useState(false);
  const [mentions, setMentions] = useState(false);
  const [globalAdmin, setGlobalAdmin] = useState(false);
  const pc = useCallback((key: Parameters<typeof productCopy>[1]) => productCopy(settings.language, key), [settings.language]);

  useEffect(() => {
    void mediaCacheLimit().then(setCacheLimitState);
    setCacheBytes(currentMediaCacheBytes());
  }, []);

  const patch = useCallback((value: Partial<AppSettings>) => {
    void update(value).catch((error: unknown) => showDialog(t("saveFailed"), userFacingError(error, t)));
  }, [showDialog, t, update]);

  const openChoice = useCallback((key: ChoiceSetting, title: string, selected: string, options: SettingsChoiceOption[]) => {
    setChoice({ key, title, selected, options });
  }, []);

  const selectChoice = useCallback((value: string) => {
    if (!choice) return;
    setChoice(null);
    switch (choice.key) {
      case "language": patch({ language: value as AppSettings["language"] }); break;
      case "theme": patch({ theme: value as AppSettings["theme"] }); break;
      case "accent": patch({ accent: value as AppSettings["accent"] }); break;
      case "fontScale": patch({ fontScale: Number(value) }); break;
      case "bubbleRadius": patch({ bubbleRadius: Number(value) }); break;
      case "defaultUploadQuality": patch({ defaultUploadQuality: value as AppSettings["defaultUploadQuality"] }); break;
      case "microphoneMode": patch({ microphoneMode: value as AppSettings["microphoneMode"] }); break;
      case "noiseSuppression": patch({ noiseSuppression: value as AppSettings["noiseSuppression"] }); break;
      case "callAudioRoute": patch({ callAudioRoute: value as AppSettings["callAudioRoute"] }); break;
      case "callQuality": patch({ callQuality: value as AppSettings["callQuality"] }); break;
      case "screenShareQuality": patch({ screenShareQuality: value as AppSettings["screenShareQuality"] }); break;
      case "mediaCacheLimit": {
        const limit = Number(value) as MediaCacheLimitMb;
        void setMediaCacheLimit(limit).then(() => setCacheLimitState(limit)).catch((error: unknown) => showDialog(t("saveFailed"), userFacingError(error, t)));
        break;
      }
    }
  }, [choice, patch]);

  const languageOptions: SettingsChoiceOption[] = [
    { value: "ru", label: t("russian") },
    { value: "en", label: t("english") },
  ];
  const themeOptions = (["system", "light", "dark"] as const).map((value) => ({ value, label: optionLabel(settings.language, value) }));
  const accentOptions = (["blue", "green", "purple", "orange", "red"] as const).map((value) => ({ value, label: optionLabel(settings.language, value), color: accentColors[value] }));
  const uploadOptions = (["data-saver", "auto", "high", "original"] as const).map((value) => ({ value, label: optionLabel(settings.language, value) }));
  const fontScaleOptions = [0.9, 1, 1.1, 1.2, 1.35].map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` }));
  const bubbleRadiusOptions = [8, 12, 16, 20, 24].map((value) => ({ value: String(value), label: `${value} px` }));
  const microphoneOptions = (["system", "phone", "speakerphone"] as const).map((value) => ({ value, label: microphoneLabel(value, t) }));
  const noiseOptions = (["off", "standard", "high"] as const).map((value) => ({ value, label: optionLabel(settings.language, value) }));
  const callRouteOptions = (["auto", "earpiece", "speaker", "headset", "bluetooth"] as const).map((value) => ({ value, label: callRouteLabel(value, t) }));
  const callQualityOptions = (["data-saver", "auto", "high"] as const).map((value) => ({ value, label: optionLabel(settings.language, value) }));
  const cacheLimitOptions = MEDIA_CACHE_LIMITS_MB.map((value) => ({ value: String(value), label: `${value} MB` }));

  const confirmClearMediaCache = () => showDialog(t("clearMediaCache"), t("clearMediaCacheQuestion"), [
    { text: t("cancel"), style: "cancel" },
    { text: t("clearMediaCache"), onPress: () => void clearMediaCache().then(() => { setCacheBytes(0); showDialog(t("cacheCleared")); }).catch((error: unknown) => showDialog(t("requestFailed"), userFacingError(error, t))) },
  ]);

  const updateBusy = appUpdate.phase === "checking" || appUpdate.phase === "downloading";
  const updateActionLabel = appUpdate.phase === "available" || appUpdate.phase === "error"
    ? t("downloadUpdate")
    : appUpdate.phase === "ready"
      ? t("installUpdate")
      : appUpdate.phase === "checking"
        ? t("checking")
        : appUpdate.phase === "downloading"
          ? t("downloading")
          : t("checkUpdates");
  const runUpdateAction = () => void (
    appUpdate.phase === "available" || appUpdate.phase === "error"
      ? appUpdate.downloadAndInstall()
      : appUpdate.phase === "ready"
        ? appUpdate.openInstaller()
        : appUpdate.checkForUpdate(true)
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScreenHeader prominent={embedded} title={t("settings")} {...(!embedded ? { left: { icon: "chevron-back" as const, label: t("back"), onPress: navigation.goBack } } : {})} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: embedded ? 24 : Math.max(insets.bottom + 16, 28) }]}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
      >
        <SettingsSection title={t("appearance")}>
          <SettingsCard>
            <SettingsRow icon="language-outline" label={t("language")} value={settings.language === "ru" ? t("russian") : t("english")} onPress={() => openChoice("language", t("language"), settings.language, languageOptions)} />
            <SettingsRow icon="moon-outline" label={t("theme")} value={optionLabel(settings.language, settings.theme)} onPress={() => openChoice("theme", t("theme"), settings.theme, themeOptions)} />
            <SettingsRow icon="color-palette-outline" label={t("accent")} value={optionLabel(settings.language, settings.accent)} valueDot={accentColors[settings.accent]} onPress={() => openChoice("accent", t("accent"), settings.accent, accentOptions)} />
            <SettingsRow icon="accessibility-outline" label={t("fontSize")} value={`${Math.round(settings.fontScale * 100)}%`} onPress={() => openChoice("fontScale", t("fontSize"), String(settings.fontScale), fontScaleOptions)} />
            <SettingsRow icon="chatbubble-outline" label={t("messageCorners")} value={`${settings.bubbleRadius} px`} onPress={() => openChoice("bubbleRadius", t("messageCorners"), String(settings.bubbleRadius), bubbleRadiusOptions)} />
          </SettingsCard>
          <SettingsCard>
            <SettingsSwitchRow icon="contract-outline" label={t("compactSpacing")} value={settings.density === "compact"} onChange={(compact) => patch({ density: compact ? "compact" : "comfortable" })} />
            <SettingsSwitchRow icon="eye-outline" label={t("highContrast")} value={settings.highContrast} onChange={(highContrast) => patch({ highContrast })} />
            <SettingsSwitchRow icon="accessibility-outline" label={t("reduceMotion")} value={settings.reducedMotion} onChange={(reducedMotion) => patch({ reducedMotion })} />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t("dataStorage")}>
          <SettingsCard>
            <SettingsRow icon="cloud-upload-outline" label={t("uploadQuality")} value={optionLabel(settings.language, settings.defaultUploadQuality)} onPress={() => openChoice("defaultUploadQuality", t("uploadQuality"), settings.defaultUploadQuality, uploadOptions)} />
            <SettingsSwitchRow icon="wifi-outline" label={t("autoWifi")} value={settings.autoDownloadWifi} onChange={(autoDownloadWifi) => patch({ autoDownloadWifi })} />
            <SettingsSwitchRow icon="cellular-outline" label={t("autoMobile")} value={settings.autoDownloadMobile} onChange={(autoDownloadMobile) => patch({ autoDownloadMobile })} />
            <SettingsSwitchRow icon="location-outline" label={t("removeLocation")} value={settings.stripMediaLocation} onChange={(stripMediaLocation) => patch({ stripMediaLocation })} />
            <SettingsRow icon="images-outline" label={t("mediaCacheLimit")} value={`${cacheLimit} MB`} onPress={() => openChoice("mediaCacheLimit", t("mediaCacheLimit"), String(cacheLimit), cacheLimitOptions)} />
            <SettingsRow icon="trash-outline" label={t("clearMediaCache")} value={formatStorageBytes(cacheBytes)} onPress={confirmClearMediaCache} />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t("voiceVideo")} footer={settings.microphoneMode === "speakerphone" ? t("microphoneSpeakerphoneHint") : undefined}>
          <SettingsCard>
            <SettingsRow icon="mic-outline" label={t("microphone")} value={microphoneLabel(settings.microphoneMode, t)} onPress={() => openChoice("microphoneMode", t("microphone"), settings.microphoneMode, microphoneOptions)} />
            <SettingsRow icon="ear-outline" label={t("callAudioRoute")} value={callRouteLabel(settings.callAudioRoute, t)} onPress={() => openChoice("callAudioRoute", t("callAudioRoute"), settings.callAudioRoute, callRouteOptions)} />
            <SettingsRow icon="cellular-outline" label={t("callQuality")} value={optionLabel(settings.language, settings.callQuality)} onPress={() => openChoice("callQuality", t("callQuality"), settings.callQuality, callQualityOptions)} />
            <SettingsRow icon="phone-portrait-outline" label={t("screenShareQuality")} value={optionLabel(settings.language, settings.screenShareQuality)} onPress={() => openChoice("screenShareQuality", t("screenShareQuality"), settings.screenShareQuality, callQualityOptions)} />
            <SettingsRow icon="sparkles-outline" label={t("noiseSuppression")} value={optionLabel(settings.language, settings.noiseSuppression)} onPress={() => openChoice("noiseSuppression", t("noiseSuppression"), settings.noiseSuppression, noiseOptions)} />
            <SettingsSwitchRow icon="repeat-outline" label={t("echoCancellation")} value={settings.echoCancellation} onChange={(echoCancellation) => patch({ echoCancellation })} />
            <SettingsSwitchRow icon="options-outline" label={t("autoGain")} value={settings.autoGainControl} onChange={(autoGainControl) => patch({ autoGainControl })} />
            <SettingsSwitchRow icon="radio-button-on-outline" label={t("pushToTalk")} value={settings.pushToTalk} onChange={(pushToTalk) => patch({ pushToTalk })} />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t("privacy")}>
          <SettingsCard>
            <SettingsRow icon="person-circle-outline" label={pc("accountSecurity")} onPress={() => setAccountPage("account")} />
            <SettingsRow icon="shield-checkmark-outline" label={pc("privacyDetails")} onPress={() => setAccountPage("privacy")} />
            <SettingsSwitchRow icon="checkmark-done-outline" label={t("readReceipts")} value={settings.readReceipts} onChange={(readReceipts) => patch({ readReceipts })} />
            <SettingsSwitchRow icon="time-outline" label={t("showLastSeen")} value={settings.showLastSeen} onChange={(showLastSeen) => patch({ showLastSeen })} />
          </SettingsCard>
          <SettingsCard>
            <SettingsRow icon="notifications-outline" label={pc("notifications")} onPress={() => setNotificationPreferences(true)} />
            <SettingsRow icon="at-outline" label={pc("mentions")} onPress={() => setMentions(true)} />
            <SettingsSwitchRow icon="sparkles-outline" label={settings.language === "ru" ? "Романтические и 18+ вопросы" : "Romantic and adult prompts"} value={settings.cooperativeMatureContent} onChange={(cooperativeMatureContent) => patch({ cooperativeMatureContent })} />
          </SettingsCard>
        </SettingsSection>

        {isAdmin ? <SettingsSection title={settings.language === "ru" ? "Администрирование" : "Administration"}>
          <SettingsCard>
            <SettingsRow icon="shield-checkmark-outline" label={settings.language === "ru" ? "Управление приложением" : "Application administration"} detail={settings.language === "ru" ? "Участники, разрешения, хранилище и сроки хранения" : "Members, permissions, storage and retention"} onPress={() => setGlobalAdmin(true)} />
          </SettingsCard>
        </SettingsSection> : null}

        <SettingsSection
          title={t("softwareUpdate")}
          footer={appUpdate.manifest?.releaseNotes.length ? (
            <View style={styles.releaseNotes}>
              {appUpdate.manifest.releaseNotes.map((note) => <Text key={note} style={[styles.releaseNote, { color: palette.secondaryText }]}>• {note}</Text>)}
            </View>
          ) : undefined}
        >
          <SettingsCard>
            <SettingsRow
              icon="phone-portrait-outline"
              label={`Snezhok ${appUpdate.currentVersion}`}
              detail={appUpdate.message ?? t("buildChannel", { build: appUpdate.currentVersionCode })}
              value={appUpdate.phase === "downloading" ? `${Math.round(appUpdate.progress * 100)}%` : null}
              valueColor={palette.accent}
            />
            <SettingsSwitchRow icon="cloud-download-outline" label={t("autoUpdateWifi")} value={appUpdate.autoUpdate} onChange={(enabled) => void appUpdate.setAutoUpdate(enabled)} />
            <SettingsRow icon="download-outline" label={updateActionLabel} onPress={runUpdateAction} disabled={updateBusy} />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t("support")}>
          <SettingsCard>
            {isAdmin ? <SettingsRow icon="alert-circle" label={t("diagnostics")} detail={t("diagnosticsDescription")} onPress={() => navigation.navigate("Diagnostics")} /> : null}
            <SettingsRow icon="globe-outline" label={pc("openSource")} detail={`GPL-3.0-or-later · ${shortSourceRevision()}`} onPress={() => showDialog(pc("openSource"), `${pc("legalNotice")}\n\n${shortSourceRevision()}`, [{ text: t("cancel"), style: "cancel" }, { text: pc("sourceCode"), onPress: () => void Linking.openURL(sourceRevisionUrl()) }])} />
          </SettingsCard>
        </SettingsSection>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("signOut")}
          onPress={() => showDialog(t("signOut"), t("signOutQuestion"), [{ text: t("cancel"), style: "cancel" }, { text: t("signOut"), style: "destructive", onPress: () => void signOut() }])}
          style={({ pressed }) => [styles.signOut, { backgroundColor: palette.dark ? palette.elevated : palette.background, borderColor: palette.border }, pressed && styles.pressed]}
        >
          <Text style={[styles.signOutText, { color: palette.danger }]}>{t("signOut")}</Text>
        </Pressable>
      </ScrollView>

      <SettingsChoiceSheet
        visible={Boolean(choice)}
        title={choice?.title ?? ""}
        selected={choice?.selected ?? ""}
        options={choice?.options ?? []}
        cancelLabel={t("cancel")}
        reducedMotion={settings.reducedMotion}
        onSelect={selectChoice}
        onClose={() => setChoice(null)}
      />
      <AccountPrivacyModal visible={accountPage !== null} initialPage={accountPage ?? "account"} onClose={() => setAccountPage(null)} />
      <NotificationPreferencesModal visible={notificationPreferences} onClose={() => setNotificationPreferences(false)} />
      <MentionsModal visible={mentions} onClose={() => setMentions(false)} />
      <GlobalAdminModal visible={globalAdmin} onClose={() => setGlobalAdmin(false)} />
    </View>
  );
}

function sourceRevision(): string {
  const revision = Constants.expoConfig?.extra?.sourceRevision;
  return typeof revision === "string" && /^[0-9a-f]{7,40}$/i.test(revision) ? revision.toLowerCase() : "development";
}

function shortSourceRevision(): string {
  const revision = sourceRevision();
  return revision === "development" ? revision : revision.slice(0, 12);
}

function sourceRevisionUrl(): string {
  const revision = sourceRevision();
  return revision === "development" ? "https://github.com/merchedits/snezhok" : `https://github.com/merchedits/snezhok/tree/${revision}`;
}

function microphoneLabel(mode: AppSettings["microphoneMode"], t: ReturnType<typeof useTranslation>["t"]): string {
  if (mode === "phone") return t("microphonePhone");
  if (mode === "speakerphone") return t("microphoneSpeakerphone");
  return t("microphoneSystem");
}

function callRouteLabel(route: AppSettings["callAudioRoute"], t: ReturnType<typeof useTranslation>["t"]): string {
  if (route === "earpiece") return t("callRouteEarpiece");
  if (route === "speaker") return t("callRouteSpeaker");
  if (route === "headset") return t("callRouteHeadset");
  if (route === "bluetooth") return t("callRouteBluetooth");
  return t("callRouteAutomatic");
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 14, paddingTop: 18, gap: 22 },
  releaseNotes: { gap: 4 },
  releaseNote: { fontSize: 12, lineHeight: 17 },
  signOut: { minHeight: 52, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  signOutText: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  pressed: { opacity: 0.62 },
});
