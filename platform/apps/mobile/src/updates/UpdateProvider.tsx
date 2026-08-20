import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Application from "expo-application";
import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import type { ReactNode } from "react";
import { AppState, BackHandler, Platform, View } from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { AndroidReleaseManifest } from "../types";
import { api, resolveApiResource } from "../infrastructure/http/apiClient";
import { userFacingError } from "../lib/userFacingError";
import { useTranslation } from "../i18n";
import { UpdateBanner } from "./UpdateBanner";
import { blocksApplicationForUpdate, isNewerRelease, isRequired, monotonicDownloadProgress } from "./updatePolicy";
import { downloadAndroidUpdate } from "./nativeUpdateDownload";

const AUTO_UPDATE_KEY = "snezhok.android.auto-update.v1";
const CHECK_INTERVAL_MS = 15 * 60 * 1_000;
const APK_MIME_TYPE = "application/vnd.android.package-archive";
const FLAG_GRANT_READ_URI_PERMISSION = 1;

class LocalizedUpdateError extends Error {}

export type UpdatePhase = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "verifying" | "ready" | "error";

interface UpdateState {
  phase: UpdatePhase;
  manifest: AndroidReleaseManifest | null;
  progress: number;
  message: string | null;
  required: boolean;
}

interface UpdateContextValue extends UpdateState {
  currentVersion: string;
  currentVersionCode: number;
  autoUpdate: boolean;
  setAutoUpdate: (enabled: boolean) => Promise<void>;
  checkForUpdate: (manual?: boolean) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  openInstaller: () => Promise<void>;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

const initialState: UpdateState = { phase: "idle", manifest: null, progress: 0, message: null, required: false };

export function AndroidUpdateProvider({ children }: { children: ReactNode }) {
  const currentVersion = Application.nativeApplicationVersion ?? "development";
  const { t } = useTranslation();
  const currentVersionCode = Number(Application.nativeBuildVersion ?? 0);
  const [state, setState] = useState<UpdateState>(initialState);
  const [autoUpdate, setAutoUpdateState] = useState(true);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const checkInFlight = useRef<Promise<void> | null>(null);
  const downloadInFlight = useRef<Promise<void> | null>(null);
  const activeDownloadId = useRef(0);
  const lastCheck = useRef(0);
  const downloadedFile = useRef<File | null>(null);
  const autoUpdateWriteQueue = useRef<Promise<void>>(Promise.resolve());

  const openInstaller = useCallback(async () => {
    const file = downloadedFile.current;
    if (!file?.exists) throw new LocalizedUpdateError(t("updateFileUnavailable"));
    setState((current) => ({ ...current, phase: "ready", message: t("updateConfirmInstaller") }));
    try {
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: file.contentUri,
        type: APK_MIME_TYPE,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      });
    } catch {
      if (Number(Platform.Version) >= 26) {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, {
          data: `package:${Application.applicationId}`,
        });
        setState((current) => ({ ...current, phase: "ready", message: t("updateAllowSource") }));
      } else {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.SECURITY_SETTINGS);
        setState((current) => ({ ...current, phase: "ready", message: t("updateAllowLegacySource") }));
      }
    }
  }, [t]);

  const downloadRelease = useCallback((manifest: AndroidReleaseManifest) => {
    if (Platform.OS !== "android") return Promise.resolve();
    if (downloadInFlight.current) return downloadInFlight.current;

    const downloadId = activeDownloadId.current + 1;
    activeDownloadId.current = downloadId;
    const operation = (async () => {
      let lastProgress = 0;
      // The stable content-addressed destination is intentional: the native
      // downloader preserves `<name>.apk.part` after a process/network failure
      // and resumes it with a validated Range request on the next attempt.
      const destination = new File(Paths.cache, `snezhok-${manifest.versionCode}-${manifest.sha256.slice(0, 12)}.apk`);
      setState({ phase: "downloading", manifest, progress: 0, message: t("downloading"), required: isRequired(manifest, currentVersionCode) });
      try {
        const downloadUrls = [
          resolveApiResource(manifest.downloadUrl),
          ...(manifest.downloadMirrors ?? []).map(resolveApiResource),
        ];
        await downloadAndroidUpdate(downloadUrls, destination.uri, manifest.bytes, manifest.sha256, (event) => {
          if (activeDownloadId.current !== downloadId) return;
          const progress = monotonicDownloadProgress(event.bytesWritten, manifest.bytes, lastProgress);
          lastProgress = progress;
          if (event.phase === "verifying") {
            setState((current) => ({ ...current, phase: "verifying", message: t("updateVerifying"), progress: 1 }));
          } else {
            setState((current) => ({
              ...current,
              phase: "downloading",
              message: event.phase === "retrying" ? t("updateReconnecting", { attempt: event.attempt }) : t("downloading"),
              progress,
            }));
          }
        });
        if (!destination.exists || destination.size !== manifest.bytes) throw new LocalizedUpdateError(t("updateBadSize"));

        const previousFile = downloadedFile.current;
        if (previousFile?.exists && previousFile.uri !== destination.uri) previousFile.delete();
        downloadedFile.current = destination;
        setState((current) => ({ ...current, phase: "ready", message: t("updateReady"), progress: 1 }));
        await openInstaller();
      } catch (error) {
        // Keep the native `.part` file. Retry and a future process can continue
        // from its durable byte offset instead of restarting at zero.
        throw error;
      }
    })();

    let trackedOperation: Promise<void>;
    trackedOperation = operation.finally(() => {
      if (downloadInFlight.current === trackedOperation) downloadInFlight.current = null;
    });
    downloadInFlight.current = trackedOperation;
    return trackedOperation;
  }, [currentVersionCode, openInstaller, t]);

  const checkForUpdate = useCallback(async (manual = false) => {
    if (Platform.OS !== "android" || __DEV__) {
      if (manual) setState((current) => ({ ...current, phase: "up-to-date", message: t("updateReleaseBuildOnly") }));
      return;
    }
    if (checkInFlight.current) return checkInFlight.current;
    const operation = (async () => {
      let foundRelease = false;
      if (manual) setState((current) => ({ ...current, phase: "checking", message: t("updateChecking") }));
      try {
        const manifest = await api.androidRelease();
        lastCheck.current = Date.now();
        if (!isNewerRelease(manifest.versionCode, currentVersionCode)) {
          if (manual) setState({ phase: "up-to-date", manifest, progress: 0, message: t("updateCurrent"), required: false });
          return;
        }
        const required = isRequired(manifest, currentVersionCode);
        foundRelease = true;
        setState({ phase: "available", manifest, progress: 0, message: t("updateAvailableVersion", { version: manifest.version }), required });
        const network = await NetInfo.fetch();
        if (autoUpdate && (network.type === "wifi" || network.type === "ethernet")) await downloadRelease(manifest);
      } catch (error) {
        if (manual || foundRelease) {
          const message = error instanceof LocalizedUpdateError ? error.message : userFacingError(error, t, "updateFailed");
          setState((current) => ({ ...current, phase: "error", message }));
        }
      }
    })().finally(() => {
      checkInFlight.current = null;
    });
    checkInFlight.current = operation;
    return operation;
  }, [autoUpdate, currentVersionCode, downloadRelease, t]);

  const downloadAndInstall = useCallback(async () => {
    if (!state.manifest) return checkForUpdate(true);
    try {
      await downloadRelease(state.manifest);
    } catch (error) {
      const message = error instanceof LocalizedUpdateError ? error.message : userFacingError(error, t, "updateFailed");
      setState((current) => ({ ...current, phase: "error", message }));
    }
  }, [checkForUpdate, downloadRelease, state.manifest, t]);

  const setAutoUpdate = useCallback((enabled: boolean) => {
    setAutoUpdateState(enabled);
    const operation = autoUpdateWriteQueue.current.then(() => AsyncStorage.setItem(AUTO_UPDATE_KEY, enabled ? "true" : "false"));
    autoUpdateWriteQueue.current = operation.catch(() => undefined);
    return operation;
  }, []);

  useEffect(() => {
    void AsyncStorage.getItem(AUTO_UPDATE_KEY).then((value) => {
      setAutoUpdateState(value !== "false");
      setPreferencesLoaded(true);
    }).catch(() => {
      // Update preferences are optional. A damaged/unavailable AsyncStorage
      // backend must not create an unhandled launch-time rejection.
      setPreferencesLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    const timer = setTimeout(() => void checkForUpdate(false), 2_500);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && Date.now() - lastCheck.current >= CHECK_INTERVAL_MS) void checkForUpdate(false);
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [checkForUpdate, preferencesLoaded]);

  const value = useMemo<UpdateContextValue>(() => ({
    ...state,
    currentVersion,
    currentVersionCode,
    autoUpdate,
    setAutoUpdate,
    checkForUpdate,
    downloadAndInstall,
    openInstaller,
  }), [autoUpdate, checkForUpdate, currentVersion, currentVersionCode, downloadAndInstall, openInstaller, setAutoUpdate, state]);
  const applicationBlocked = blocksApplicationForUpdate(state.required, state.phase);

  useEffect(() => {
    if (!applicationBlocked || Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [applicationBlocked]);

  return (
    <UpdateContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        <View
          style={{ flex: 1 }}
          pointerEvents={applicationBlocked ? "none" : "auto"}
          accessibilityElementsHidden={applicationBlocked}
          importantForAccessibility={applicationBlocked ? "no-hide-descendants" : "auto"}
        >
          {children}
        </View>
        <UpdateBanner />
      </View>
    </UpdateContext.Provider>
  );
}

export function useAndroidUpdate() {
  const value = useContext(UpdateContext);
  if (!value) throw new Error("useAndroidUpdate must be used inside AndroidUpdateProvider");
  return value;
}
