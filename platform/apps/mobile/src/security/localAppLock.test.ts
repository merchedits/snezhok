import assert from "node:assert/strict";
import test from "node:test";

import { shouldConcealApp } from "./appLockPolicy";

test("app lock conceals only a signed-in app outside the active foreground", () => {
  assert.equal(shouldConcealApp(true, true, "background"), true);
  assert.equal(shouldConcealApp(true, true, "inactive"), true);
  assert.equal(shouldConcealApp(true, true, "active"), false);
  assert.equal(shouldConcealApp(false, true, "background"), false);
  assert.equal(shouldConcealApp(true, false, "background"), false);
});
