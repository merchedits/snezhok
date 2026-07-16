import assert from "node:assert/strict";
import test from "node:test";
import { parseMentionCursor } from "./routes.js";

test("mention cursor preserves stable timestamp and id ordering", () => {
  assert.deepEqual(parseMentionCursor("1700000000000123:00000000-0000-4000-8000-000000000001"), {
    atMicros: "1700000000000123",
    id: "00000000-0000-4000-8000-000000000001",
  });
});
