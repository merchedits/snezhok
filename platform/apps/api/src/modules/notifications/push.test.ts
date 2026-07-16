import assert from "node:assert/strict";
import test from "node:test";
import { fetchExpoReceipts, PushGatewayError, pushContentForEvent, sendExpoPush } from "./push.js";
import { retryDelaySeconds } from "./pushWorker.js";

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

test("disabled previews never expose message content", () => {
  const result = pushContentForEvent("u2", "message:created", {
    streamId: "s", streamKind: "conversation", text: "private secret", sender: { id: "u1", displayName: "Anna" },
  }, { language: "en", showPreview: false });
  assert.equal(result?.body, "New message");
  assert.equal(JSON.stringify(result).includes("private secret"), false);
});

test("attachment and call copy follows the recipient language", () => {
  const media = pushContentForEvent("u2", "message:created", {
    streamId: "s", streamKind: "conversation", kind: "voice", sender: { id: "u1", displayName: "Anna" },
  }, { language: "en", showPreview: true });
  assert.equal(media?.body, "Voice message");
  const call = pushContentForEvent("u2", "call:updated", {
    roomId: "r", streamId: "s", streamKind: "conversation", state: "started", callerId: "u1", callerName: "Anna",
  }, { language: "en", showPreview: true });
  assert.equal(call?.title, "Incoming call · Anna");
  assert.equal(call?.body, "Tap to answer");
  assert.deepEqual(call?.data, { notificationType: "call", roomId: "r", streamId: "s", streamKind: "conversation", title: "Anna", callerId: "u1", callerName: "Anna", startedAt: undefined });
});

test("call end is a quiet background lifecycle event", () => {
  const result = pushContentForEvent("u2", "call:updated", { roomId: "r", state: "ended", answeredByIds: ["u2"] });
  assert.equal(result?._contentAvailable, true);
  assert.equal(result?.title, undefined);
  assert.deepEqual(result?.data, { notificationType: "call-ended", roomId: "r", answered: true });
});

test("voice channel joins never produce incoming-call push notifications", () => {
  const result = pushContentForEvent("u2", "call:updated", {
    roomId: "r", streamId: "voice", streamKind: "channel", state: "started", callerId: "u1", callerName: "Anna",
  });
  assert.equal(result, null);
});

test("Expo tickets are persisted only after provider acceptance", async () => {
  const ticket = await sendExpoPush("ExpoPushToken[test]", { data: { notificationType: "message" } }, async () => new Response(JSON.stringify({
    data: { status: "ok", id: "ticket-1" },
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(ticket, "ticket-1");
});

test("Expo terminal token failures are classified without retry storms", async () => {
  await assert.rejects(
    sendExpoPush("bad", { data: {} }, async () => new Response(JSON.stringify({
      data: { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
    }), { status: 200, headers: { "content-type": "application/json" } })),
    (error: unknown) => error instanceof PushGatewayError && error.code === "DeviceNotRegistered" && error.retryable === false,
  );
});

test("receipt responses remain keyed to their durable provider ticket", async () => {
  const receipts = await fetchExpoReceipts(["ticket-1"], async () => new Response(JSON.stringify({
    data: { "ticket-1": { status: "error", details: { error: "DeviceNotRegistered" } } },
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(receipts["ticket-1"]?.details?.error, "DeviceNotRegistered");
});

test("push retries use capped exponential backoff", () => {
  assert.equal(retryDelaySeconds(1), 5);
  assert.equal(retryDelaySeconds(4), 40);
  assert.equal(retryDelaySeconds(20), 3_600);
});
