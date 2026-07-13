import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationSummary, Message } from "@snezhok/contracts";

import { applyConversationPreview } from "./conversationPreview";

const sender: Message["sender"] = {
  id: "sender",
  username: "snow",
  displayName: "Snow",
  avatarUrl: null,
  avatarColor: "#ffffff",
  bio: "",
  statusText: "",
  presence: "online",
  lastSeenAt: 0,
};

function conversation(lastMessage: ConversationSummary["lastMessage"] = null): ConversationSummary {
  return {
    id: "chat",
    kind: "direct",
    title: "",
    avatarUrl: null,
    participants: [sender],
    lastMessage,
    unreadCount: 0,
    mentionCount: 0,
    muted: false,
    pinned: false,
    archived: false,
    saved: false,
    updatedAt: lastMessage?.createdAt ?? 0,
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "message",
    clientId: null,
    streamId: "chat",
    streamKind: "conversation",
    sequence: 1,
    sender,
    kind: "text",
    text: "hello",
    replyTo: null,
    forwardedFrom: null,
    attachments: [],
    reactions: [],
    createdAt: 10,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

test("adds an optimistic message to an empty chat preview immediately", () => {
  const result = applyConversationPreview([conversation()], message({ id: "client", clientId: "client", pending: true }));
  assert.equal(result[0]?.lastMessage?.id, "client");
  assert.equal(result[0]?.lastMessage?.text, "hello");
  assert.equal(result[0]?.updatedAt, 10);
});

test("replaces the optimistic preview with the server message", () => {
  const optimistic = message({ id: "client", clientId: "client", pending: true });
  const initial = applyConversationPreview([conversation()], optimistic);
  const result = applyConversationPreview(initial, message({ id: "server", clientId: "client", createdAt: 11 }));
  assert.equal(result[0]?.lastMessage?.id, "server");
});

test("does not replace a newer preview with an older realtime edit", () => {
  const result = applyConversationPreview(
    [conversation({ id: "newer", senderId: "sender", senderName: "Snow", text: "new", kind: "text", createdAt: 20 })],
    message({ id: "older", createdAt: 10, text: "edited" }),
  );
  assert.equal(result[0]?.lastMessage?.id, "newer");
});

test("does not apply channel messages to direct-chat summaries", () => {
  const initial = [conversation()];
  assert.equal(applyConversationPreview(initial, message({ streamKind: "channel" })), initial);
});
