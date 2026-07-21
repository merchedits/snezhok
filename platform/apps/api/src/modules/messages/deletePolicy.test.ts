import assert from "node:assert/strict";
import test from "node:test";
import { mayDeleteForEveryone } from "./deletePolicy.js";

test("group deletion preserves author and administrator boundaries", () => {
  const base = { streamKind: "conversation" as const, conversationKind: "group" as const, actorIsAuthor: false, managesChannelMessages: false };
  assert.equal(mayDeleteForEveryone({ ...base, actorRole: "member" }), false);
  assert.equal(mayDeleteForEveryone({ ...base, actorRole: "admin" }), true);
  assert.equal(mayDeleteForEveryone({ ...base, actorRole: "owner" }), true);
  assert.equal(mayDeleteForEveryone({ ...base, actorRole: "member", actorIsAuthor: true }), true);
});

test("bilateral direct deletion and channel moderation remain explicit", () => {
  assert.equal(mayDeleteForEveryone({ streamKind: "conversation", conversationKind: "direct", actorIsAuthor: false, actorRole: "member", managesChannelMessages: false }), true);
  assert.equal(mayDeleteForEveryone({ streamKind: "channel", conversationKind: null, actorIsAuthor: false, actorRole: "moderator", managesChannelMessages: false }), false);
  assert.equal(mayDeleteForEveryone({ streamKind: "channel", conversationKind: null, actorIsAuthor: false, actorRole: "member", managesChannelMessages: true }), true);
});
