import assert from "node:assert/strict";
import test from "node:test";

import { parseRichText } from "./richText";

test("parses safe rich-text marks, quotes and HTTP links without HTML", () => {
  const [line, quote] = parseRichText("**Bold** _soft_ `code` https://example.com/a.\n> quoted");
  assert.deepEqual(line?.tokens.map((token) => [token.text, token.marks[0] ?? null]), [["Bold", "bold"], [" ", null], ["soft", "italic"], [" ", null], ["code", "mono"], [" ", null], ["https://example.com/a", "link"], [".", null]]);
  assert.equal(quote?.quote, true);
  assert.equal(quote?.tokens[0]?.text, "quoted");
});

test("never promotes javascript or bare-host text to a link", () => {
  const tokens = parseRichText("javascript:alert(1) example.com")[0]?.tokens ?? [];
  assert.equal(tokens.some((token) => token.marks.includes("link")), false);
});
