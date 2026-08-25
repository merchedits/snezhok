import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Application from "expo-application";
import { File, Paths } from "expo-file-system";
import type { ReactNode } from "react";
import { AppState, BackHandler, Platform, View } from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { AndroidReleaseManifest } from "../types";
import { recordDiagnostic } from "../diagnostics/diagnostics";
import { api, resolveApiResource } from "../infrastructure/http/apiClient";
import { userFacingError } from "../lib/userFacingError";
import { useTranslation } from "../i18n";
import { UpdateBanner } from "./UpdateBanner";
import { blocksApplicationForUpdate, isNewerRelease, isRequired, monotonicDownloadProgress } from "./updatePolicy";
import { downloadAndroidUpdate } from "./nativeUpdateDownload";
import { requestAndroidUpdateInstallation } from "./nativeUpdateInstaller";

const AUTO_UPDATE_KEY = "snezhok.android.auto-update.v1";
const CHECK_INTERVAL_MS = 15 * 60 * 1_000;
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
  const downloadedRelease = useRef<AndroidReleaseManifest | null>(null);
  const autoUpdateWriteQueue = useRef<Promise<void>>(Promise.resolve());

  const openInstaller = useCallback(async () => {
    const file = downloadedFile.current;
    const manifest = downloadedRelease.current;
    if (!file || !manifest) {
      setState((current) => ({ ...current, phase: "error", message: t("updateFileUnavailable") }));
      return;
    }
    try {
      const status = await requestAndroidUpdateInstallation(file.uri, manifest.bytes, manifest.sha256);
      if (status === "launched") {
        setState((current) => ({ ...current, phase: "ready", message: t("updateConfirmInstaller") }));
      } else if (status === "permission-required") {
        setState((current) => ({ ...current, phase: "ready", message: t("updateAllowSource") }));
      } else {
        throw new LocalizedUpdateError(status === "settings-unavailable" ? t("updateSettingsUnavailable") : t("updateInstallerUnavailable"));
      }
    } catch (error) {
      recordUpdateFailure("installer", error);
      const message = error instanceof LocalizedUpdateError ? error.message : t("updateInstallFailed");
      setState((current) => ({ ...current, phase: "error", message }));
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
      const nativePhase: { current: "downloading" | "retrying" | "verifying" } = { current: "downloading" };
      try {
        const downloadUrls = [
          resolveApiResource(manifest.downloadUrl),
          ...(manifest.downloadMirrors ?? []).map(resolveApiResource),
        ];
        await downloadAndroidUpdate(downloadUrls, destination.uri, manifest.bytes, manifest.sha256, (event) => {
          if (activeDownloadId.current !== downloadId) return;
          nativePhase.current = event.phase;
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

        const previousFile = downloadedFile.current;
        if (previousFile && previousFile.uri !== destination.uri) {
          try {
            if (previousFile.exists) previousFile.delete();
          } catch {
            // Android owns its cache lifecycle; stale cleanup must never block
            // installation of the newly verified artifact.
          }
        }
        downloadedFile.current = destination;
        downloadedRelease.current = manifest;
        setState((current) => ({ ...current, phase: "ready", message: t("updateReady"), progress: 1 }));
        await openInstaller();
      } catch (error) {
        // Keep the native `.part` file. Retry and a future process can continue
        // from its durable byte offset instead of restarting at zero.
        recordUpdateFailure(nativePhase.current === "verifying" ? "verification" : "download", error);
        throw new LocalizedUpdateError(nativePhase.current === "verifying" ? t("updateVerificationFailed") : t("updateDownloadFailed"));
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

function recordUpdateFailure(stage: "download" | "verification" | "installer", error: unknown): void {
  recordDiagnostic("error", "lifecycle", "Android update failed", {
    stage,
    errorName: error instanceof Error ? error.name : "unknown",
    reason: error instanceof Error ? error.message : String(error),
  });
}
