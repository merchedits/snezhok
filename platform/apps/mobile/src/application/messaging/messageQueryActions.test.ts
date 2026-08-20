import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationSummary, Message, UserSummary } from "@snezhok/contracts";

import { emptyAttachmentRepository } from "../../repositories/attachments/attachmentRepository";
import { emptyMessageRepository } from "../../repositories/messages/messageRepository";
import type { PersistenceRequest } from "../../infrastructure/persistence/appPersistenceCoordinator";
import { defaultRuntimeCapabilities, defaultSettings, type AppState, type AppStorePatch } from "../../store/appState";
import { createMessageQueryDomain } from "./messageQueryActions";

test("cold chat publishes cached messages before the network page resolves", async () => {
  let releaseNetwork!: () => void;
  const networkGate = new Promise<void>((resolve) => { releaseNetwork = resolve; });
  const cached = message({ id: "cached", sequence: 1, text: "cached" });
  const remote = message({ id: "remote", sequence: 2, text: "remote" });
  const fixture = createFixture({
    readPage: async () => [cached],
    messages: async () => {
      await networkGate;
      return { items: [remote], nextCursor: null };
    },
  });

  const loading = fixture.domain.actions.loadMessages("chat");
  await waitUntil(() => fixture.state.messages.chat?.[0]?.id === "cached");
  assert.equal(fixture.state.messages.chat?.[0]?.text, "cached");
  releaseNetwork();
  await loading;

  assert.deepEqual(fixture.state.messages.chat?.map((item) => item.id), ["cached", "remote"]);
  assert.deepEqual(fixture.state.messagePagination.chat, { nextCursor: null, initialized: true });
});

test("concurrent latest-page requests share one transport operation", async () => {
  let calls = 0;
  let releaseNetwork!: () => void;
  const networkGate = new Promise<void>((resolve) => { releaseNetwork = resolve; });
  const fixture = createFixture({
    messages: async () => {
      calls += 1;
      await networkGate;
      return { items: [], nextCursor: null };
    },
  });

  const first = fixture.domain.actions.loadMessages("chat");
  const second = fixture.domain.actions.loadMessages("chat");
  assert.equal(first, second);
  releaseNetwork();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("an account change prevents a late network page from entering state", async () => {
  let current = true;
  let releaseNetwork!: () => void;
  const networkGate = new Promise<void>((resolve) => { releaseNetwork = resolve; });
  const fixture = createFixture({
    guardIsCurrent: () => current,
    messages: async () => {
      await networkGate;
      return { items: [message({ id: "wrong-account" })], nextCursor: null };
    },
  });

  const loading = fixture.domain.actions.loadMessages("chat");
  await Promise.resolve();
  current = false;
  releaseNetwork();
  await loading;
  assert.equal(fixture.state.messages.chat, undefined);
});

test("offline read acknowledgement is queued durably and clears unread optimistically", async () => {
  const fixture = createFixture();
  fixture.patch({ online: false, conversations: [conversation({ unreadCount: 3, mentionCount: 1 })] });

  await fixture.domain.actions.markStreamRead("chat", 8);

  assert.equal(fixture.state.conversations[0]?.unreadCount, 0);
  assert.equal(fixture.state.outbox[0]?.kind, "read");
  assert.equal(fixture.state.outbox[0]?.id, "operation-1");
  assert.equal(fixture.persisted.some((request) => request.outbox), true);
});

interface Overrides {
  readPage?: (...args: Parameters<ReturnType<typeof cacheFixture>["readPage"]>) => ReturnType<ReturnType<typeof cacheFixture>["readPage"]>;
  messages?: (...args: Parameters<ReturnType<typeof transportFixture>["messages"]>) => ReturnType<ReturnType<typeof transportFixture>["messages"]>;
  guardIsCurrent?: () => boolean;
}

function createFixture(overrides: Overrides = {}) {
  let state = baseState();
  const persisted: PersistenceRequest[] = [];
  const set = (patch: AppStorePatch) => {
    const value = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...value };
  };
  const cache = cacheFixture();
  if (overrides.readPage) cache.readPage = overrides.readPage;
  const transport = transportFixture();
  if (overrides.messages) transport.messages = overrides.messages;
  let id = 0;
  const domain = createMessageQueryDomain({
    set,
    get: () => state,
    persist: (request) => { persisted.push(request); },
    captureGuard: () => 1,
    guardIsCurrent: overrides.guardIsCurrent ?? (() => true),
    createId: () => `operation-${++id}`,
    now: () => 1_000,
    transport,
    cache,
  });
  return {
    domain,
    get state() { return state; },
    patch: (patch: AppStorePatch) => set(patch),
    persisted,
  };
}

function cacheFixture() {
  return {
    readPage: async (_streamId: string, _before?: number, _limit?: number): Promise<Message[]> => [],
    readPages: async (_streamIds: readonly string[], _limit?: number): Promise<Record<string, Message[]>> => ({}),
  };
}

function transportFixture() {
  return {
    messages: async (_streamId: string, _before?: number) => ({ items: [] as Message[], nextCursor: null as string | null }),
    messageContext: async (messageId: string) => ({ streamId: "chat", targetId: messageId, items: [] as Message[] }),
    markRead: async (streamId: string, sequence: number) => ({ streamId, userId: "me", sequence }),
    markUnread: async (streamId: string, sequence: number) => ({ streamId, userId: "me", sequence, markedUnread: true as const }),
    pinnedMessages: async (_streamId: string) => [] as Message[],
  };
}

function baseState(): AppState {
  return {
    phase: "ready", error: null, online: true, syncing: false, eventCursor: 0, me: user("me"),
    conversations: [], servers: [], categories: [], channels: [], friends: [], settings: defaultSettings,
    capabilities: defaultRuntimeCapabilities, messages: {}, attachmentRepository: emptyAttachmentRepository,
    messageRepository: emptyMessageRepository, messagePagination: {}, drafts: {}, folders: [], scheduledMessages: [],
    outbox: [], refreshBootstrap: async () => undefined,
  } as unknown as AppState;
}

function conversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: "chat", kind: "direct", title: "Peer", avatarUrl: null, avatarColor: "#000", participants: [user("peer")],
    lastMessage: null, unreadCount: 0, mentionCount: 0, updatedAt: 1, pinnedAt: null, archived: false, mutedUntil: null,
    ...overrides,
  } as ConversationSummary;
}

function user(id: string): UserSummary {
  return { id, username: id, displayName: id, avatarUrl: null, avatarColor: "#000", presence: "offline", lastSeenAt: 0 } as UserSummary;
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "message", clientId: null, streamId: "chat", streamKind: "conversation", sequence: 1, revision: 1,
    sender: user("peer"), kind: "text", text: "hello", replyTo: null, forwardedFrom: null, attachments: [], reactions: [],
    createdAt: 1, editedAt: null, deletedAt: null, pinnedAt: null, silent: false, readByOthers: false, pending: false, failed: false,
    ...overrides,
  } as Message;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not reached");
}
