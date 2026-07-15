import assert from "node:assert/strict";
import test from "node:test";

import { mergeAcknowledgedPatch, rollbackRejectedPatch } from "./settingsSync";

test("an older settings acknowledgement cannot overwrite a newer tap", () => {
  const current = { compact: false, accent: "blue" };
  const saved = { compact: true, accent: "blue" };
  assert.deepEqual(mergeAcknowledgedPatch(current, { compact: true }, saved), current);
});

test("a rejected settings request only rolls back its still-current fields", () => {
  const previous = { compact: false, accent: "blue" };
  const current = { compact: true, accent: "purple" };
  assert.deepEqual(rollbackRejectedPatch(current, { compact: true, accent: "green" }, previous), { compact: false, accent: "purple" });
});
