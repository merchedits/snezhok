import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const store = readFileSync(new URL("./useAppStore.ts", import.meta.url), "utf8");
const repository = readFileSync(new URL("../lib/offlineRepository.ts", import.meta.url), "utf8");
const session = readFileSync(new URL("../lib/secureSession.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");
const productApi = readFileSync(new URL("../lib/productApi.ts", import.meta.url), "utf8");
const appConfig = readFileSync(new URL("../../app.config.ts", import.meta.url), "utf8");
const callRoom = readFileSync(new URL("../calls/CallRoomView.tsx", import.meta.url), "utf8");

function operation(start: string, end: string): string {
  const from = store.indexOf(start);
  const to = store.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return store.slice(from, to);
}

test("every optimistic message mutation is durable before its network request", () => {
  const cases = [
    ["sendMessage: async", "forwardMessage: async", "api.createMessage"],
    ["forwardMessage: async", "editMessage: async", "api.forwardMessage"],
    ["editMessage: async", "toggleReaction: async", "api.editMessage"],
    ["toggleReaction: async", "deleteMessage: async", "api.setReaction"],
    ["deleteMessage: async", "setMessagePinned: async", "api.deleteMessage"],
    ["setMessagePinned: async", "retryOutbox: async", "api.setMessagePinned"],
  ] as const;
  for (const [start, end, networkCall] of cases) {
    const source = operation(start, end);
    const persisted = source.indexOf("await persistState({");
    assert.ok(persisted >= 0, `${start} must persist`);
    assert.ok(persisted < source.indexOf(networkCall), `${start} must persist before ${networkCall}`);
  }
});

test("offline repositories bind SQLite, drafts, and outbox data to one owner", () => {
  assert.match(repository, /ensureOfflineOwner/);
  assert.match(repository, /DELETE FROM cached_messages; DELETE FROM cache_metadata/);
  assert.match(repository, /OUTBOX_KEY, DRAFTS_KEY, DRAFT_DIRTY_KEY/);
});

test("a late token refresh cannot recreate a logged-out or replaced session", () => {
  assert.match(session, /mutationQueue/);
  assert.match(session, /writeSessionIfCurrent\(tokens: AuthTokens, expectedGeneration: number\)/);
  assert.match(session, /clearSessionIfCurrent\(expectedGeneration: number\)/);
  assert.match(session, /mutationGeneration !== expectedGeneration/);
  assert.match(api, /const sessionGeneration = getSessionGeneration\(\)/);
  assert.match(api, /writeSessionIfCurrent\(tokens, sessionGeneration\)/);
  assert.match(api, /clearSessionIfCurrent\(sessionGeneration\)/);
  assert.match(productApi, /const sessionGeneration = getSessionGeneration\(\)/);
  assert.match(productApi, /writeSessionIfCurrent/);
  assert.match(productApi, /clearSessionIfCurrent\(sessionGeneration\)/);
});

test("expired credentials unmount private UI before failure-contained cleanup", () => {
  const listener = store.slice(store.indexOf("function ensureSessionLossListener"), store.indexOf("function schedulePersistence"));
  const signedOut = listener.indexOf('phase: "signed-out"');
  const cleanup = listener.indexOf("terminalDataClear =");
  assert.ok(signedOut >= 0 && signedOut < cleanup, "the authenticated tree must unmount before durable cleanup starts");
  assert.match(listener, /Promise\.allSettled\(\[/);
  assert.match(listener, /Expired session cleanup was incomplete/);
  assert.doesNotMatch(listener, /terminalDataClear = Promise\.all\(/);
});

test("asynchronous store completions are scoped to the account that started them", () => {
  assert.match(store, /function captureAccountOperation\(\)/);
  assert.match(store, /guard\.epoch === accountEpoch/);
  assert.match(store, /signOut: async \(\) => \{\s+invalidateAccountOperations\(\)/);

  const send = operation("sendMessage: async", "forwardMessage: async");
  assert.match(send, /const guard = captureAccountOperation\(\)/);
  assert.match(send, /const saved = await api\.createMessage/);
  assert.match(send, /if \(!accountOperationIsCurrent\(guard\)\) return/);
});

test("private message state is excluded from Android backup", () => {
  assert.match(appConfig, /allowBackup:\s*false/);
});

test("startup binds durable data to the authenticated token before reading it", () => {
  const initialize = operation("initialize: async", "signIn: async");
  assert.ok(initialize.indexOf("await ensureOfflineOwner(ownerId)") < initialize.indexOf("const cache = await readCache()"));
  assert.match(initialize, /session\.expiresAt > Date\.now\(\)/);
  assert.match(initialize, /phase: cachedSessionIsFresh \? "ready" : "booting"/);
  assert.match(repository, /!row\?\.value && !storageOwner/);
  assert.match(repository, /bootstrapOwner && bootstrapOwner !== ownerId/);
});

test("camera publication rolls back when foreground-service promotion fails", () => {
  assert.match(callRoom, /if \(!updateCallForegroundService\([^)]*nextEnabled\)\) \{/);
  assert.match(callRoom, /await localParticipant\.setCameraEnabled\(isCameraEnabled\)/);
});
