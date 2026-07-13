import assert from "node:assert/strict";
import test from "node:test";

import { composerBottomPadding } from "./keyboardLayout";

test("composer uses the safe area only while the software keyboard is closed", () => {
  assert.equal(composerBottomPadding(24, false), 24);
  assert.equal(composerBottomPadding(24, true), 7);
  assert.equal(composerBottomPadding(0, false), 7);
});
