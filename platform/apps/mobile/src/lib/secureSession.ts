import * as SecureStore from "expo-secure-store";

import type { AuthTokens } from "../types";

const SESSION_KEY = "snezhok.session.v1";
let runtimeSession: AuthTokens | null = null;
const listeners = new Set<() => void>();

function updateRuntime(tokens: AuthTokens | null) {
  runtimeSession = tokens;
  for (const listener of listeners) listener();
}

export async function readSession(): Promise<AuthTokens | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AuthTokens>;
    if (!parsed.accessToken || !parsed.refreshToken || typeof parsed.expiresAt !== "number") return null;
    const session = parsed as AuthTokens;
    updateRuntime(session);
    return session;
  } catch {
    return null;
  }
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
  return runtimeSession;
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
