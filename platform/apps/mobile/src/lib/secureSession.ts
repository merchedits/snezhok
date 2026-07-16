import * as SecureStore from "expo-secure-store";

import type { AuthTokens } from "../types";
import { AsyncValueCache } from "./asyncValueCache";

const SESSION_KEY = "snezhok.session.v1";
const listeners = new Set<() => void>();
const sessionCache = new AsyncValueCache<AuthTokens>(() => {
  for (const listener of listeners) listener();
});

function updateRuntime(tokens: AuthTokens | null) {
  sessionCache.set(tokens);
}

export async function readSession(): Promise<AuthTokens | null> {
  return sessionCache.read(async () => {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<AuthTokens>;
      if (!parsed.accessToken || !parsed.refreshToken || typeof parsed.expiresAt !== "number") return null;
      return parsed as AuthTokens;
    } catch {
      return null;
    }
  });
}

export async function writeSession(tokens: AuthTokens): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(tokens), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  updateRuntime(tokens);
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
  updateRuntime(null);
}

export function getRuntimeSession(): AuthTokens | null {
  return sessionCache.peek();
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
