import assert from "node:assert/strict";
import test from "node:test";

import { composerBottomPadding } from "./keyboardLayout";

test("composer uses the safe area only while the software keyboard is closed", () => {
  assert.equal(composerBottomPadding(24, false), 32);
  assert.equal(composerBottomPadding(24, true), 8);
  assert.equal(composerBottomPadding(0, false), 16);
});

test("composer leaves a visible gap above Android three-button navigation", () => {
  assert.equal(composerBottomPadding(48, false), 56);
  assert.equal(composerBottomPadding(48, true), 8);
});
