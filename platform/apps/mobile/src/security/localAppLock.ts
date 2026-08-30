import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

const APP_LOCK_KEY = "snezhok.app-lock.enabled.v1";
let cached = false;
let loaded = false;
const listeners = new Set<() => void>();

export async function loadAppLockEnabled(): Promise<boolean> {
  if (!loaded) {
    cached = await SecureStore.getItemAsync(APP_LOCK_KEY).then((value) => value === "1").catch(() => false);
    loaded = true;
    emit();
  }
  return cached;
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  if (enabled) await SecureStore.setItemAsync(APP_LOCK_KEY, "1");
  else await SecureStore.deleteItemAsync(APP_LOCK_KEY);
  cached = enabled;
  loaded = true;
  emit();
}

export function useAppLockEnabled(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): boolean { return cached; }
function emit(): void { listeners.forEach((listener) => listener()); }
