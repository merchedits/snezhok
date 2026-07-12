import assert from "node:assert/strict";
import test from "node:test";
import { orderedPair } from "./service.js";

test("friendship keys are canonical regardless of request direction", () => {
  const a = "00000000-0000-4000-8000-000000000001";
  const b = "00000000-0000-4000-8000-000000000002";
  assert.deepEqual(orderedPair(a, b), [a, b]);
  assert.deepEqual(orderedPair(b, a), [a, b]);
});
