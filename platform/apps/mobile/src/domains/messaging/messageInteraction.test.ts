import assert from "node:assert/strict";
import test from "node:test";

import { messagePrimaryPressAction } from "./messageInteraction";

test("ordinary message taps open reactions without waiting for another tap", () => {
  assert.equal(messagePrimaryPressAction(false), "open-reactions");
});

test("message taps toggle selection while selection mode is active", () => {
  assert.equal(messagePrimaryPressAction(true), "toggle-selection");
});
