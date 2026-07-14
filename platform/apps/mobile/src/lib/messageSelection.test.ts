import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import { selectedMessageText } from "./messageSelection";

function message(sequence: number, text: string): Message {
  return { sequence, text } as Message;
}

test("copies selected message text in chronological order", () => {
  assert.equal(selectedMessageText([message(3, "third"), message(1, " first "), message(2, "second")]), "first\nsecond\nthird");
});

test("omits attachment-only and blank messages from clipboard text", () => {
  assert.equal(selectedMessageText([message(1, ""), message(2, "  "), message(3, "caption")]), "caption");
});
