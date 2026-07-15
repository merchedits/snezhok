import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import type { ReactNode } from "react";
import { AppState, Platform, View } from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { AndroidReleaseManifest } from "../types";
import { api, resolveApiResource } from "../lib/api";
import { useTranslation } from "../i18n";
import { UpdateBanner } from "./UpdateBanner";
import { arrayBufferToHex, isNewerRelease, isRequired, monotonicDownloadProgress } from "./updatePolicy";

const AUTO_UPDATE_KEY = "snezhok.android.auto-update.v1";
const CHECK_INTERVAL_MS = 15 * 60 * 1_000;
const APK_MIME_TYPE = "application/vnd.android.package-archive";
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export type UpdatePhase = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";

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
    if (!file?.exists) throw new Error("The downloaded update is no longer available.");
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
      // Every attempt gets its own destination. A stale native task can therefore
      // never truncate or append to the APK owned by a newer attempt.
      const destination = new File(Paths.cache, `snezhok-${manifest.versionCode}-${Date.now()}-${downloadId}.apk`);
      if (destination.exists) destination.delete();
      setState({ phase: "downloading", manifest, progress: 0, message: t("downloading"), required: isRequired(manifest, currentVersionCode) });
      const task = File.createDownloadTask(resolveApiResource(manifest.downloadUrl), destination, {
        onProgress: ({ bytesWritten }) => {
          if (activeDownloadId.current !== downloadId) return;
          const progress = monotonicDownloadProgress(bytesWritten, manifest.bytes, lastProgress);
          if (progress === lastProgress) return;
          lastProgress = progress;
          setState((current) => current.phase === "downloading" ? { ...current, progress } : current);
        },
      });
      try {
        const file = await task.downloadAsync();
        if (!file || file.size !== manifest.bytes) throw new Error(t("updateBadSize"));
        setState((current) => ({ ...current, message: t("updateVerifying"), progress: 1 }));
        const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes());
        if (arrayBufferToHex(digest) !== manifest.sha256.toLowerCase()) throw new Error(t("updateVerificationFailed"));

        const previousFile = downloadedFile.current;
        if (previousFile?.exists && previousFile.uri !== file.uri) previousFile.delete();
        downloadedFile.current = file;
        setState((current) => ({ ...current, phase: "ready", message: t("updateReady"), progress: 1 }));
        await openInstaller();
      } catch (error) {
        if (destination.exists) destination.delete();
        throw error;
      } finally {
        task.release();
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
          setState((current) => ({ ...current, phase: "error", message: error instanceof Error ? error.message : t("updateFailed") }));
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
      setState((current) => ({ ...current, phase: "error", message: error instanceof Error ? error.message : t("updateFailed") }));
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

  return (
    <UpdateContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
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
