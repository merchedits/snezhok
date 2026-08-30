import assert from "node:assert/strict";
import test from "node:test";

import { decodeStoredAccounts, mergeStoredAccount } from "./accountVaultModel";

test("secure account index is bounded, ordered and rejects malformed owners", () => {
  assert.deepEqual(decodeStoredAccounts([{ ownerId: "../bad", username: "x", displayName: "X", lastUsedAt: 2 }]), []);
  const first = { ownerId: "one", username: "one", displayName: "One", lastUsedAt: 1 };
  const second = { ownerId: "two", username: "two", displayName: "Two", lastUsedAt: 2 };
  assert.deepEqual(mergeStoredAccount([first], second, 1), { accounts: [second], evictedOwnerIds: ["one"] });
  assert.deepEqual(mergeStoredAccount([first, second], { ...first, lastUsedAt: 3 }, 5).accounts.map((item) => item.ownerId), ["one", "two"]);
});
