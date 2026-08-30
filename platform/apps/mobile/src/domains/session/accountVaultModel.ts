export interface StoredAccountModel { ownerId: string; username: string; displayName: string; lastUsedAt: number }

export function validStoredOwner(value: string): boolean { return /^[A-Za-z0-9._-]{1,128}$/u.test(value); }

export function decodeStoredAccounts(value: unknown, limit = 5): StoredAccountModel[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStoredAccount).sort((left, right) => right.lastUsedAt - left.lastUsedAt).slice(0, Math.max(0, limit));
}

export function mergeStoredAccount(current: readonly StoredAccountModel[], account: StoredAccountModel, limit = 5): { accounts: StoredAccountModel[]; evictedOwnerIds: string[] } {
  const previous = decodeStoredAccounts(current, Number.MAX_SAFE_INTEGER).filter((item) => item.ownerId !== account.ownerId);
  const accounts = [account, ...previous].slice(0, Math.max(0, limit));
  return { accounts, evictedOwnerIds: previous.filter((item) => !accounts.some((saved) => saved.ownerId === item.ownerId)).map((item) => item.ownerId) };
}

function isStoredAccount(value: unknown): value is StoredAccountModel {
  const item = value as Partial<StoredAccountModel>;
  return Boolean(item && typeof item.ownerId === "string" && validStoredOwner(item.ownerId) && typeof item.username === "string" && typeof item.displayName === "string" && typeof item.lastUsedAt === "number" && Number.isFinite(item.lastUsedAt));
}
