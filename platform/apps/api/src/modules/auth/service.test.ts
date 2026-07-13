import assert from "node:assert/strict";
import test from "node:test";
import { hashOpaqueToken } from "./service.js";

test("opaque token hashing is deterministic without retaining the token", () => {
  const token = "a-sensitive-refresh-token";
  const hash = hashOpaqueToken(token);
  assert.equal(hash, hashOpaqueToken(token));
  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{64}$/);
});
