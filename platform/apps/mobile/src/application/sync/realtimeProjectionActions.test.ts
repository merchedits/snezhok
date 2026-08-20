import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationSummary, Message, UserSummary } from "@snezhok/contracts";

import { defaultRuntimeCapabilities, defaultSettings, type AppState, type AppStorePatch } from "../../store/appState";
import { emptyAttachmentRepository } from "../../repositories/attachments/attachmentRepository";
import { emptyMessageRepository } from "../../repositories/messages/messageRepository";
import type { PersistenceRequest } from "../../infrastructure/persistence/appPersistenceCoordinator";
import { createRealtimeProjectionActions } from "./realtimeProjectionActions";

const me = user("me");
const peer = user("peer");
const streamId = "stream";

test("duplicate created event increments unread exactly once", () => {
  const fixture = createFixture();
  const incoming = message({ id: "message-1", revision: 1, sender: peer });

  fixture.actions.applyMessage(incoming, "created");
  fixture.actions.applyMessage(incoming, "created");

  assert.equal(fixture.state.conversations[0]?.unreadCount, 1);
  assert.equal(fixture.state.messages[streamId]?.length, 1);
});

test("lower message revision cannot overwrite a newer projection", () => {
  const fixture = createFixture();
  fixture.actions.applyMessage(message({ id: "message-1", revision: 4, text: "new", sender: peer }), "updated");
  fixture.actions.applyMessage(message({ id: "message-1", revision: 3, text: "stale", sender: peer }), "updated");

  assert.equal(fixture.state.messages[streamId]?.[0]?.text, "new");
  assert.equal(fixture.state.messages[streamId]?.[0]?.revision, 4);
});

test("conversation removal forgets query state and persists the stream tombstone", () => {
  const fixture = createFixture();
  fixture.actions.applyMessage(message({ id: "message-1", revision: 1, sender: peer }), "updated");
  fixture.actions.removeConversation(streamId);

  assert.equal(fixture.state.conversations.length, 0);
  assert.equal(fixture.state.messages[streamId], undefined);
  assert.deepEqual(fixture.forgotten, [streamId]);
  assert.deepEqual([...(fixture.persistence.at(-1)?.removedStreamIds ?? [])], [streamId]);
});

function createFixture() {
  let state = baseState();
  const persisted: PersistenceRequest[] = [];
  const forgotten: string[] = [];
  const set = (patch: AppStorePatch) => {
    const value = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...value };
  };
  const actions = createRealtimeProjectionActions({
    set,
    get: () => state,
    persist: (request) => persisted.push(request),
    markStreamLoaded: () => undefined,
    forgetStream: (id) => forgotten.push(id),
  });
  return {
    actions,
    get state() { return state; },
    persistence: persisted,
    forgotten,
  };
}

function baseState(): AppState {
  const conversation = {
    id: streamId,
    kind: "direct",
    title: "Peer",
    avatarUrl: null,
    avatarColor: "#000",
    saved: false,
    pinned: false,
    archived: false,
    muted: false,
    unreadCount: 0,
    mentionCount: 0,
    updatedAt: 0,
    participants: [me, peer],
    lastMessage: null,
  } as ConversationSummary;
  return {
    phase: "ready",
    error: null,
    online: true,
    syncing: false,
    eventCursor: 0,
    me,
    conversations: [conversation],
    servers: [], categories: [], channels: [], friends: [],
    settings: defaultSettings,
    capabilities: defaultRuntimeCapabilities,
    messages: {},
    attachmentRepository: emptyAttachmentRepository,
    messageRepository: emptyMessageRepository,
    messagePagination: {}, drafts: {}, folders: [], scheduledMessages: [], outbox: [],
  } as unknown as AppState;
}

function user(id: string): UserSummary {
  return { id, username: id, displayName: id, avatarUrl: null, avatarColor: "#000", presence: "offline", lastSeenAt: 0 } as UserSummary;
}

function message(overrides: Partial<Message>): Message {
  return {
    id: "message",
    clientId: null,
    streamId,
    streamKind: "conversation",
    sequence: 1,
    revision: 1,
    kind: "text",
    text: "hello",
    sender: peer,
    attachments: [],
    reactions: [],
    replyTo: null,
    createdAt: 1,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    readByOthers: false,
    pending: false,
    failed: false,
    ...overrides,
  } as Message;
}
