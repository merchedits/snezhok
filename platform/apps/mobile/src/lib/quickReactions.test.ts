import assert from "node:assert/strict";
import test from "node:test";

import { QUICK_REACTIONS } from "./quickReactions";

test("quick reactions are unique and keep heart as the double-tap default", () => {
  assert.equal(QUICK_REACTIONS[0], "\u2764\uFE0F");
  assert.equal(new Set(QUICK_REACTIONS).size, QUICK_REACTIONS.length);
  assert.ok(QUICK_REACTIONS.length >= 6);
});
