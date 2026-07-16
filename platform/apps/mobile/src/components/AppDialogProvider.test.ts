import assert from "node:assert/strict";
import test from "node:test";

import { enqueueUniqueDialog, normalizeDialogActions } from "../lib/dialogActions";

test("dialog supplies one localized acknowledgement action by default", () => {
  assert.deepEqual(normalizeDialogActions(undefined, "Хорошо"), [{ text: "Хорошо" }]);
});

test("dialog preserves explicit action order and roles", () => {
  const actions = [{ text: "Cancel", style: "cancel" as const }, { text: "Delete", style: "destructive" as const }];
  assert.equal(normalizeDialogActions(actions, "OK"), actions);
});

test("dialog queue ignores repeated rapid failures and remains bounded", () => {
  const first = { title: "Upload failed", message: "Try again", id: 1 };
  assert.deepEqual(enqueueUniqueDialog([first], { ...first, id: 2 }), [first]);
  const full = Array.from({ length: 4 }, (_, index) => ({ title: `Error ${index}`, id: index }));
  assert.deepEqual(enqueueUniqueDialog(full, { title: "Overflow", id: 5 }), full);
});
