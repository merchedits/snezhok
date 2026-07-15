import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDialogActions } from "../lib/dialogActions";

test("dialog supplies one localized acknowledgement action by default", () => {
  assert.deepEqual(normalizeDialogActions(undefined, "Хорошо"), [{ text: "Хорошо" }]);
});

test("dialog preserves explicit action order and roles", () => {
  const actions = [{ text: "Cancel", style: "cancel" as const }, { text: "Delete", style: "destructive" as const }];
  assert.equal(normalizeDialogActions(actions, "OK"), actions);
});
