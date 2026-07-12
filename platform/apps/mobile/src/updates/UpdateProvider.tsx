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
import { UpdateBanner } from "./UpdateBanner";
import { arrayBufferToHex, isNewerRelease, isRequired } from "./updatePolicy";

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
  const currentVersionCode = Number(Application.nativeBuildVersion ?? 0);
  const [state, setState] = useState<UpdateState>(initialState);
  const [autoUpdate, setAutoUpdateState] = useState(true);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const checkInFlight = useRef<Promise<void> | null>(null);
  const lastCheck = useRef(0);
  const downloadedFile = useRef<File | null>(null);

  const openInstaller = useCallback(async () => {
    const file = downloadedFile.current;
    if (!file?.exists) throw new Error("The downloaded update is no longer available.");
    setState((current) => ({ ...current, phase: "ready", message: "Confirm the update in Android's installer." }));
    try {
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: file.contentUri,
        type: APK_MIME_TYPE,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      });
    } catch {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, {
        data: `package:${Application.applicationId}`,
      });
      setState((current) => ({ ...current, phase: "ready", message: "Allow installs from Snezhok, then tap Install again." }));
    }
  }, []);

  const downloadRelease = useCallback(async (manifest: AndroidReleaseManifest) => {
    if (Platform.OS !== "android") return;
    const destination = new File(Paths.cache, `snezhok-${manifest.versionCode}.apk`);
    if (destination.exists) destination.delete();
    setState({ phase: "downloading", manifest, progress: 0, message: "Downloading update…", required: isRequired(manifest, currentVersionCode) });
    const task = File.createDownloadTask(resolveApiResource(manifest.downloadUrl), destination, {
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : manifest.bytes;
        setState((current) => ({ ...current, progress: Math.min(1, bytesWritten / total) }));
      },
    });
    try {
      const file = await task.downloadAsync();
      if (!file || file.size !== manifest.bytes) throw new Error("The downloaded update has an unexpected size.");
      setState((current) => ({ ...current, message: "Verifying update…", progress: 1 }));
      const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes());
      if (arrayBufferToHex(digest) !== manifest.sha256.toLowerCase()) {
        file.delete();
        throw new Error("Update verification failed. The downloaded file was removed.");
      }
      downloadedFile.current = file;
      setState((current) => ({ ...current, phase: "ready", message: "Update verified and ready to install.", progress: 1 }));
      await openInstaller();
    } finally {
      task.release();
    }
  }, [currentVersionCode, openInstaller]);

  const checkForUpdate = useCallback(async (manual = false) => {
    if (Platform.OS !== "android" || __DEV__) {
      if (manual) setState((current) => ({ ...current, phase: "up-to-date", message: "Update checks run in release builds." }));
      return;
    }
    if (checkInFlight.current) return checkInFlight.current;
    const operation = (async () => {
      if (manual) setState((current) => ({ ...current, phase: "checking", message: "Checking for updates…" }));
      try {
        const manifest = await api.androidRelease();
        lastCheck.current = Date.now();
        if (!isNewerRelease(manifest.versionCode, currentVersionCode)) {
          if (manual) setState({ phase: "up-to-date", manifest, progress: 0, message: "Snezhok is up to date.", required: false });
          return;
        }
        const required = isRequired(manifest, currentVersionCode);
        setState({ phase: "available", manifest, progress: 0, message: `Snezhok ${manifest.version} is available.`, required });
        const network = await NetInfo.fetch();
        if (autoUpdate && (network.type === "wifi" || network.type === "ethernet")) await downloadRelease(manifest);
      } catch (error) {
        if (manual) setState((current) => ({ ...current, phase: "error", message: error instanceof Error ? error.message : "Update check failed." }));
      }
    })().finally(() => {
      checkInFlight.current = null;
    });
    checkInFlight.current = operation;
    return operation;
  }, [autoUpdate, currentVersionCode, downloadRelease]);

  const downloadAndInstall = useCallback(async () => {
    if (!state.manifest) return checkForUpdate(true);
    try {
      await downloadRelease(state.manifest);
    } catch (error) {
      setState((current) => ({ ...current, phase: "error", message: error instanceof Error ? error.message : "Update failed." }));
    }
  }, [checkForUpdate, downloadRelease, state.manifest]);

  const setAutoUpdate = useCallback(async (enabled: boolean) => {
    setAutoUpdateState(enabled);
    await AsyncStorage.setItem(AUTO_UPDATE_KEY, enabled ? "true" : "false");
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
