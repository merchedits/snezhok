import assert from "node:assert/strict";
import test from "node:test";
import { classifyCallFailure } from "./callDiagnostics";

test("classifies common LiveKit failures", () => {
  assert.equal(classifyCallFailure(new Error("ICE failed: no TURN candidate")), "relay");
  assert.equal(classifyCallFailure(new Error("websocket timeout")), "network");
  assert.equal(classifyCallFailure(new Error("microphone permission denied")), "permission");
  assert.equal(classifyCallFailure(new Error("token is unauthorized")), "authentication");
});
