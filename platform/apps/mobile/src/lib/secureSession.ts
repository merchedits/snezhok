import * as SecureStore from "expo-secure-store";

import type { AuthTokens } from "../types";
import { AsyncValueCache } from "./asyncValueCache";
import { forgetStoredAccount, updateStoredAccountTokens } from "./accountVault";

const SESSION_KEY = "snezhok.session.v1";
const listeners = new Set<() => void>();
const eventListeners = new Set<(event: SessionChangeEvent) => void>();
let mutationGeneration = 0;
let mutationQueue: Promise<void> = Promise.resolve();
const sessionCache = new AsyncValueCache<AuthTokens>(() => {
  for (const listener of listeners) listener();
});

export interface SessionChangeEvent {
  previousOwnerId: string | null;
  ownerId: string | null;
  preservedStoredAccount: boolean;
}

function updateRuntime(tokens: AuthTokens | null, preservedStoredAccount = false) {
  const previousOwnerId = sessionOwnerId(sessionCache.peek());
  sessionCache.set(tokens);
  const event: SessionChangeEvent = {
    previousOwnerId,
    ownerId: sessionOwnerId(tokens),
    preservedStoredAccount,
  };
  for (const listener of eventListeners) listener(event);
}

export async function readSession(): Promise<AuthTokens | null> {
  return sessionCache.read(async () => {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<AuthTokens>;
      if (!parsed.accessToken || !parsed.refreshToken || typeof parsed.expiresAt !== "number") return null;
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt: parsed.expiresAt,
        ...(typeof parsed.ownerId === "string" && parsed.ownerId.length > 0 ? { ownerId: parsed.ownerId } : {}),
      };
    } catch {
      return null;
    }
  });
}

export async function writeSession(tokens: AuthTokens): Promise<void> {
  await enqueueMutation(async () => {
    await persistSession(tokens);
    mutationGeneration += 1;
    updateRuntime(tokens);
  });
}

/**
 * Rotates credentials only if no login/logout mutation occurred while the
 * refresh request was in flight. This prevents a late refresh response from
 * resurrecting a session after logout or replacing a newer account.
 */
export async function writeSessionIfCurrent(tokens: AuthTokens, expectedGeneration: number): Promise<boolean> {
  let written = false;
  await enqueueMutation(async () => {
    if (mutationGeneration !== expectedGeneration) return;
    await persistSession(tokens);
    mutationGeneration += 1;
    updateRuntime(tokens);
    written = true;
  });
  return written;
}

export async function clearSession(options: { preserveStoredAccount?: boolean } = {}): Promise<void> {
  await enqueueMutation(async () => {
    const ownerId = sessionOwnerId(sessionCache.peek());
    await SecureStore.deleteItemAsync(SESSION_KEY);
    if (ownerId && !options.preserveStoredAccount) await forgetStoredAccount(ownerId);
    mutationGeneration += 1;
    updateRuntime(null, options.preserveStoredAccount === true);
  });
}

/** Clears rejected credentials only when they still identify the live session. */
export async function clearSessionIfCurrent(expectedGeneration: number): Promise<boolean> {
  let cleared = false;
  await enqueueMutation(async () => {
    if (mutationGeneration !== expectedGeneration) return;
    const ownerId = sessionOwnerId(sessionCache.peek());
    await SecureStore.deleteItemAsync(SESSION_KEY);
    if (ownerId) await forgetStoredAccount(ownerId);
    mutationGeneration += 1;
    updateRuntime(null);
    cleared = true;
  });
  return cleared;
}

export function getRuntimeSession(): AuthTokens | null {
  return sessionCache.peek();
}

/** Returns the authenticated account without trusting cache metadata. */
export function sessionOwnerId(tokens: AuthTokens | null): string | null {
  if (!tokens) return null;
  if (tokens.ownerId) return tokens.ownerId;
  try {
    const payload = tokens.accessToken.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const parsed = JSON.parse(globalThis.atob(normalized)) as { sub?: unknown };
    return typeof parsed.sub === "string" && parsed.sub.length > 0 ? parsed.sub : null;
  } catch {
    return null;
  }
}

export function getSessionGeneration(): number {
  return mutationGeneration;
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeToSessionEvents(listener: (event: SessionChangeEvent) => void): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

async function persistSession(tokens: AuthTokens): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(tokens), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await updateStoredAccountTokens(tokens);
}

function enqueueMutation(operation: () => Promise<void>): Promise<void> {
  const result = mutationQueue.catch(() => undefined).then(operation);
  mutationQueue = result.catch(() => undefined);
  return result;
}
