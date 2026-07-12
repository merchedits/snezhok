import assert from "node:assert/strict";
import test from "node:test";
import { deterministicId } from "./ids.js";

test("deterministic IDs are stable, namespaced UUIDs", () => {
  const first = deterministicId("user", "legacy-1");
  assert.equal(first, deterministicId("user", "legacy-1"));
  assert.notEqual(first, deterministicId("message", "legacy-1"));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
