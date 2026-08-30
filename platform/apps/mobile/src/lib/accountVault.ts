import * as SecureStore from "expo-secure-store";

import type { UserSummary } from "@snezhok/contracts";
import type { AuthTokens } from "../types";
import { decodeStoredAccounts, mergeStoredAccount, validStoredOwner, type StoredAccountModel } from "../domains/session/accountVaultModel";

export type StoredAccount = StoredAccountModel;
const INDEX_KEY = "snezhok.accounts.v1";
const MAX_ACCOUNTS = 5;
let mutation: Promise<void> = Promise.resolve();

export async function listStoredAccounts(): Promise<StoredAccount[]> {
  try {
    const raw = await SecureStore.getItemAsync(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return [];
    return decodeStoredAccounts(parsed, MAX_ACCOUNTS);
  } catch { return []; }
}

export async function rememberStoredAccount(tokens: AuthTokens, user: Pick<UserSummary, "id" | "username" | "displayName">): Promise<string[]> {
  if (!safeOwner(user.id)) return [];
  let evicted: string[] = [];
  await queue(async () => {
    const current = await listStoredAccounts();
    const { accounts: next, evictedOwnerIds } = mergeStoredAccount(current, { ownerId: user.id, username: user.username, displayName: user.displayName, lastUsedAt: Date.now() }, MAX_ACCOUNTS);
    await SecureStore.setItemAsync(tokenKey(user.id), JSON.stringify(tokens), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(next), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    for (const ownerId of evictedOwnerIds) await SecureStore.deleteItemAsync(tokenKey(ownerId));
    evicted = evictedOwnerIds;
  });
  return evicted;
}

export async function updateStoredAccountTokens(tokens: AuthTokens): Promise<void> {
  if (!tokens.ownerId || !safeOwner(tokens.ownerId)) return;
  const ownerId = tokens.ownerId;
  await queue(async () => {
    const accounts = await listStoredAccounts();
    const account = accounts.find((item) => item.ownerId === ownerId);
    if (!account) return;
    const next = mergeStoredAccount(accounts, { ...account, lastUsedAt: Date.now() }, MAX_ACCOUNTS).accounts;
    await SecureStore.setItemAsync(tokenKey(ownerId), JSON.stringify(tokens), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(next), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  });
}

export async function readStoredAccount(ownerId: string): Promise<AuthTokens | null> {
  if (!safeOwner(ownerId)) return null;
  try {
    const raw = await SecureStore.getItemAsync(tokenKey(ownerId));
    const value = raw ? JSON.parse(raw) as Partial<AuthTokens> : null;
    return value?.accessToken && value.refreshToken && typeof value.expiresAt === "number" ? { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt, ownerId } : null;
  } catch { return null; }
}

export async function forgetStoredAccount(ownerId: string): Promise<void> {
  if (!safeOwner(ownerId)) return;
  await queue(async () => {
    const next = (await listStoredAccounts()).filter((account) => account.ownerId !== ownerId);
    await Promise.all([SecureStore.deleteItemAsync(tokenKey(ownerId)), SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(next), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })]);
  });
}

function queue(operation: () => Promise<void>): Promise<void> { const next = mutation.catch(() => undefined).then(operation); mutation = next.catch(() => undefined); return next; }
function tokenKey(ownerId: string): string { return `snezhok.account.${ownerId}.v1`; }
const safeOwner = validStoredOwner;
