import assert from "node:assert/strict";
import test from "node:test";
import { pushContentForEvent } from "./push.js";

test("does not notify the message sender", () => {
  assert.equal(pushContentForEvent("u1", "message:created", { streamId: "s", sender: { id: "u1", displayName: "Me" } }), null);
});

test("silent messages never create push notifications", () => {
  assert.equal(pushContentForEvent("u2", "message:created", { streamId: "s", silent: true, sender: { id: "u1", displayName: "Anna" } }), null);
});

test("builds a native message notification", () => {
  const result = pushContentForEvent("u2", "message:created", { streamId: "s", streamKind: "conversation", text: "hello", sender: { id: "u1", displayName: "Anna" } });
  assert.equal(result?.title, "Anna");
  assert.equal(result?.body, "hello");
  assert.equal(result?.channelId, "messages-v1");
});

test("call end is a quiet background lifecycle event", () => {
  const result = pushContentForEvent("u2", "call:updated", { roomId: "r", state: "ended", answeredByIds: ["u2"] });
  assert.equal(result?._contentAvailable, true);
  assert.equal(result?.title, undefined);
  assert.deepEqual(result?.data, { notificationType: "call-ended", roomId: "r", answered: true });
});
