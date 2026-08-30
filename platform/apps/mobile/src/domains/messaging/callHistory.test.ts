import assert from "node:assert/strict";
import test from "node:test";

import { callDurationLabel, parseCallHistoryEvent } from "./callHistory";

test("call history accepts only the versioned server envelope", () => {
  assert.deepEqual(parseCallHistoryEvent('{"v":1,"type":"call","status":"missed","durationMs":1200}'), { status: "missed", durationMs: 1200 });
  assert.equal(parseCallHistoryEvent('{"type":"call","status":"missed"}'), null);
  assert.equal(parseCallHistoryEvent("not-json"), null);
  assert.equal(callDurationLabel(125_999), "2:05");
});
