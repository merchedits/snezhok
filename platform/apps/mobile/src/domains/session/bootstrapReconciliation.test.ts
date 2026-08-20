import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationSummary, Message, MessagePreview } from "@snezhok/contracts";

import { reconcileBootstrapConversations, type BootstrapReconciliationState } from "./bootstrapReconciliation";

test("bootstrap keeps a durable optimistic preview and a pending read acknowledgement", () => {
  const optimistic = message({ id: "client-1", clientId: "client-1", pending: true, text: "local" });
  const local = conversation({ lastMessage: preview({ id: "client-1", text: "local", createdAt: 20 }), updatedAt: 20, unreadCount: 0 });
  const remote = conversation({ lastMessage: preview({ id: "server-old", text: "old", createdAt: 10 }), updatedAt: 10, unreadCount: 4, mentionCount: 2 });
  const state = {
    conversations: [local],
    messages: { chat: [optimistic] },
    outbox: [{ kind: "read", streamId: "chat" }],
  } satisfies BootstrapReconciliationState;

  const [saved] = reconcileBootstrapConversations(state, [remote]);

  assert.equal(saved?.lastMessage?.text, "local");
  assert.equal(saved?.updatedAt, 20);
  assert.equal(saved?.unreadCount, 0);
  assert.equal(saved?.mentionCount, 0);
});

function conversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: "chat", kind: "direct", title: "Peer", avatarUrl: null, avatarColor: "#000", participants: [],
    lastMessage: null, unreadCount: 0, mentionCount: 0, updatedAt: 1, pinnedAt: null, archived: false, mutedUntil: null,
    ...overrides,
  } as ConversationSummary;
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "message", clientId: null, streamId: "chat", streamKind: "conversation", sequence: 1, revision: 1,
    sender: { id: "me", username: "me", displayName: "Me", avatarUrl: null, avatarColor: "#000", presence: "online", lastSeenAt: 1 },
    kind: "text", text: "hello", replyTo: null, forwardedFrom: null, attachments: [], reactions: [], createdAt: 1,
    editedAt: null, deletedAt: null, pinnedAt: null, silent: false, readByOthers: false, pending: false, failed: false,
    ...overrides,
  } as Message;
}

function preview(overrides: Partial<MessagePreview> = {}): MessagePreview {
  return { id: "message", senderId: "me", senderName: "Me", text: "hello", kind: "text", createdAt: 1, ...overrides };
}
