import assert from "node:assert/strict";
import test from "node:test";

import { applyTextFormat } from "./textFormatting";

test("formatting preserves the selected text and returns its new selection", () => {
  assert.deepEqual(applyTextFormat("say hello now", { start: 4, end: 9 }, "bold"), { text: "say **hello** now", selection: { start: 6, end: 11 } });
  assert.deepEqual(applyTextFormat("one\ntwo", { start: 0, end: 7 }, "quote").text, "> one\n> two");
});
