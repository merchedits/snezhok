import assert from "node:assert/strict";
import test from "node:test";

import type { Message, UserSummary } from "@snezhok/contracts";

import { emptyAttachmentRepository } from "../../repositories/attachments/attachmentRepository";
import { emptyMessageRepository } from "../../repositories/messages/messageRepository";
import { defaultRuntimeCapabilities, defaultSettings, type AppState, type AppStorePatch } from "../../store/appState";
import type { OutboxTransport } from "./outboxDispatcher";
import { createMessageMutationDomain } from "./messageMutationDomain";

const me = user("me");
const peer = user("peer");

test("offline send durably persists the optimistic message and outbox before resolving", async () => {
  const fixture = createFixture();
  fixture.state.online = false;

  await fixture.domain.actions.sendMessage("chat", { text: "hello", kind: "text", replyToId: null, attachmentIds: [], silent: false });

  assert.equal(fixture.state.messages.chat?.[0]?.pending, true);
  assert.equal(fixture.state.outbox.length, 1);
  assert.equal(fixture.persistedNow.length, 1);
  assert.equal(fixture.persistedNow[0]?.outbox, true);
});

test("online send durably persists both optimistic and acknowledged states", async () => {
  const fixture = createFixture();

  await fixture.domain.actions.sendMessage("chat", { text: "hello", kind: "text", replyToId: null, attachmentIds: [], silent: false });

  assert.equal(fixture.state.messages.chat?.[0]?.pending, false);
  assert.equal(fixture.state.outbox.length, 0);
  assert.equal(fixture.persistedNow.length, 2);
  assert.equal(fixture.persistedNow[1]?.outbox, true);
});

test("delete for me uses the non-destructive hide endpoint", async () => {
  let hidden = 0;
  let deleted = 0;
  const fixture = createFixture({
    hideMessage: async () => { hidden += 1; },
    deleteMessage: async () => { deleted += 1; return message({ deletedAt: Date.now() }); },
  });
  const current = message();
  fixture.state.messages = { chat: [current] };

  await fixture.domain.actions.deleteMessage(current, "me");

  assert.equal(hidden, 1);
  assert.equal(deleted, 0);
  assert.equal(fixture.state.messages.chat?.length, 0);
  assert.equal(fixture.state.outbox.length, 0);
});

test("a lower-revision edit response cannot overwrite newer realtime state", async () => {
  const current = message({ revision: 3, text: "old" });
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const fixture = createFixture({
    editMessage: async () => { await responseGate; return message({ revision: 2, text: "server-stale" }); },
  });
  fixture.state.messages = { chat: [current] };
  const editing = fixture.domain.actions.editMessage(current, "local edit");
  await Promise.resolve();
  fixture.state.messages = { chat: [message({ revision: 4, text: "realtime-new" })] };
  releaseResponse();
  await editing;

  assert.equal(fixture.state.messages.chat?.[0]?.text, "realtime-new");
  assert.equal(fixture.state.messages.chat?.[0]?.revision, 4);
});

function createFixture(overrides: Partial<OutboxTransport> = {}) {
  let state = baseState();
  const persistedNow: Array<{ outbox?: boolean }> = [];
  const transport: OutboxTransport = {
    createMessage: async (_streamId, input) => message({ id: "server", clientId: input.clientId, text: input.text, pending: false }),
    forwardMessage: async () => message(),
    markRead: async () => undefined,
    editMessage: async (_id, text) => message({ text }),
    hideMessage: async () => undefined,
    deleteMessage: async () => message({ deletedAt: Date.now() }),
    setMessagePinned: async (_id, pinned) => message({ pinnedAt: pinned ? Date.now() : null }),
    setReaction: async () => message(),
    ...overrides,
  };
  const set = (patch: AppStorePatch) => {
    const value = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...value };
  };
  let id = 0;
  const domain = createMessageMutationDomain({
    set,
    get: () => state,
    persist: () => undefined,
    persistNow: async (request) => { persistedNow.push(request); },
    captureGuard: () => 1,
    guardIsCurrent: () => true,
    createId: () => `client-${++id}`,
    transport,
  });
  return { domain, get state() { return state; }, persistedNow };
}

function baseState(): AppState {
  return {
    phase: "ready", error: null, online: true, syncing: false, eventCursor: 0, me,
    conversations: [], servers: [], categories: [], channels: [], friends: [],
    settings: defaultSettings, capabilities: defaultRuntimeCapabilities, messages: {},
    attachmentRepository: emptyAttachmentRepository, messageRepository: emptyMessageRepository,
    messagePagination: {}, drafts: {}, folders: [], scheduledMessages: [], outbox: [],
    refreshBootstrap: async () => undefined,
  } as unknown as AppState;
}

function user(id: string): UserSummary {
  return { id, username: id, displayName: id, avatarUrl: null, avatarColor: "#000", presence: "offline", lastSeenAt: 0 } as UserSummary;
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "message", clientId: null, streamId: "chat", streamKind: "conversation", sequence: 1, revision: 1,
    sender: peer, kind: "text", text: "hello", replyTo: null, forwardedFrom: null, attachments: [], reactions: [],
    createdAt: 1, editedAt: null, deletedAt: null, pinnedAt: null, silent: false, readByOthers: false, pending: false, failed: false,
    ...overrides,
  } as Message;
}
