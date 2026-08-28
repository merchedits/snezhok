import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "@snezhok/contracts";
import { visibleReadSequence } from "./readVisibility";

const message = (sequence: number, senderId: string): Message => ({
  id: `m${sequence}`, revision: 1, clientId: null, streamId: "chat", streamKind: "conversation", sequence,
  sender: { id: senderId, username: senderId, displayName: senderId, avatarUrl: null, avatarColor: "#000", bio: "", statusText: "", presence: "offline", lastSeenAt: 0 },
  kind: "text", text: "message", attachments: [], reactions: [], replyTo: null, forwardedFrom: null,
  createdAt: sequence, editedAt: null, deletedAt: null, pinnedAt: null, readByOthers: false, silent: false,
});

test("backgrounded or hidden chats never advance remote read receipts", () => {
  const messages = [message(8, "peer"), message(9, "me")];
  assert.equal(visibleReadSequence(messages, "me", { appActive: false, screenFocused: true, routeSettled: true }), null);
  assert.equal(visibleReadSequence(messages, "me", { appActive: true, screenFocused: false, routeSettled: true }), null);
  assert.equal(visibleReadSequence(messages, "me", { appActive: true, screenFocused: true, routeSettled: true }), 8);
});
