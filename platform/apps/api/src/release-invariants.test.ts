import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Message } from "@snezhok/contracts";
import { shouldExposeTokens } from "./modules/auth/routes.js";
import { canEndCall } from "./modules/calls/routes.js";
import { clampReadSequence, personalizeMessage } from "./modules/messages/service.js";
import { canAssignRole, canManageRole, normalizeChannelName } from "./modules/servers/routes.js";
import { parseRange } from "./modules/uploads/routes.js";
import { isSafeLegacyStoredName } from "./lib/legacy-files.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFile(path.resolve(here, relative), "utf8");

test("owner and administrator hierarchy cannot escalate or manage peers", () => {
  assert.equal(canManageRole("owner", "admin"), true);
  assert.equal(canManageRole("admin", "admin"), false);
  assert.equal(canManageRole("admin", "moderator"), true);
  assert.equal(canAssignRole("admin", "admin"), false);
  assert.equal(canAssignRole("owner", "admin"), true);
});

test("read cursors and HTTP ranges are bounded by durable content", () => {
  assert.equal(clampReadSequence(999, 12), 12);
  assert.equal(clampReadSequence(-5, 12), 0);
  assert.deepEqual(parseRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(parseRange("bytes=100-101", 100), "invalid");
});

test("call termination and browser token exposure are least privilege", () => {
  assert.equal(canEndCall("member", "starter", "member"), false);
  assert.equal(canEndCall("starter", "starter", "member"), true);
  assert.equal(canEndCall("moderator", "starter", "moderator"), true);
  assert.equal(shouldExposeTokens("web"), false);
  assert.equal(shouldExposeTokens("android"), true);
});

test("recipient-specific reaction state is derived for each viewer", () => {
  const message = { reactions: [{ emoji: "👍", count: 1, reacted: false, userIds: ["viewer-a"] }] } as Message;
  assert.equal(personalizeMessage(message, "viewer-a").reactions[0]!.reacted, true);
  assert.equal(personalizeMessage(message, "viewer-b").reactions[0]!.reacted, false);
});

test("legacy filenames and returned channel names are canonical", () => {
  assert.equal(isSafeLegacyStoredName("../../passwd"), false);
  assert.equal(isSafeLegacyStoredName("nested/file.png"), false);
  assert.equal(isSafeLegacyStoredName("safe-file.png"), true);
  assert.equal(normalizeChannelName("  Project Chat  "), "project-chat");
});

test("database and source contain the serialized release invariants", async () => {
  const [migration, auth, authRoutes, conversations, importer, legacyFiles, events, socket, uploadRoutes, uploadService, app, calls, reactions, messageService, bootstrap] = await Promise.all([
    source("../migrations/0001_initial.sql"), source("modules/auth/service.ts"), source("modules/auth/routes.ts"),
    source("modules/conversations/routes.ts"), source("commands/import-legacy.ts"), source("lib/legacy-files.ts"), source("modules/realtime/events.ts"), source("modules/realtime/socket.ts"),
    source("modules/uploads/routes.ts"), source("modules/uploads/uploadService.ts"), source("app.ts"), source("modules/calls/routes.ts"), source("modules/messages/routes.ts"), source("modules/messages/service.ts"), source("modules/bootstrap/service.ts"),
  ]);
  assert.match(migration, /call_sessions_one_active_stream_idx/);
  assert.match(migration, /'finalizing'/);
  assert.match(migration, /payload jsonb NOT NULL/);
  assert.match(auth, /pg_advisory_xact_lock/);
  assert.match(conversations, /pg_advisory_xact_lock\(hashtext/);
  assert.match(importer, /sqlite\.exec\("BEGIN"\)/);
  assert.match(importer, /ON CONFLICT/);
  assert.match(legacyFiles, /isSymbolicLink/);
  assert.match(events, /pg_notify\('snezhok_events'/);
  assert.match(socket, /LISTEN snezhok_events/);
  assert.match(uploadService, /stageObject/);
  assert.match(uploadService, /info\.size !== Number\(locked\.declared_bytes\)/);
  assert.match(uploadRoutes, /offset \+ chunk\.length > Number\(upload\.declared_bytes\)/);
  assert.match(app, /trustProxy: config\.TRUST_PROXY_HOPS/);
  assert.match(app, /fastifyStatic/);
  assert.match(authRoutes, /rateLimit: \{ max: 5/);
  assert.match(calls, /WebhookReceiver/);
  assert.doesNotMatch(reactions, /decodeURIComponent/);
  assert.match(messageService, /readReceipts/);
  assert.match(messageService, /showLastSeen/);
  assert.match(bootstrap, /readSnapshot/);
});
