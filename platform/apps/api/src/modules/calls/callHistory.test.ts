import assert from "node:assert/strict";
import test from "node:test";

import { callHistoryText } from "./callHistory.js";

test("call history payload is deterministic, bounded and distinguishes missed calls", () => {
  assert.deepEqual(JSON.parse(callHistoryText(false, -10)), { v: 1, type: "call", status: "missed", durationMs: 0 });
  assert.deepEqual(JSON.parse(callHistoryText(true, 12_345.4)), { v: 1, type: "call", status: "completed", durationMs: 12_345 });
});
