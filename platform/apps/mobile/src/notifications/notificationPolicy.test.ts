import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import { shouldNotifyCall, shouldNotifyMessage } from "./notificationPolicy";

const message = { sender: { id: "other" }, createdAt: 95_000, deletedAt: null } as Message;

test("message notifications only include recent messages from another user", () => {
  assert.equal(shouldNotifyMessage(message, "me", 100_000), true);
  assert.equal(shouldNotifyMessage(message, "other", 100_000), false);
  assert.equal(shouldNotifyMessage({ ...message, createdAt: 1 }, "me", 100_000), false);
});

test("call notifications require a recent incoming started event", () => {
  const call = { state: "started" as const, callerId: "other", streamId: "stream", startedAt: 95_000 };
  assert.equal(shouldNotifyCall(call, "me", 100_000), true);
  assert.equal(shouldNotifyCall(call, "other", 100_000), false);
  assert.equal(shouldNotifyCall({ ...call, state: "ended" }, "me", 100_000), false);
  assert.equal(shouldNotifyCall({ ...call, startedAt: 1 }, "me", 100_000), false);
});
