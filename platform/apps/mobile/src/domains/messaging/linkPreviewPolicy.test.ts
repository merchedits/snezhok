import assert from "node:assert/strict";
import test from "node:test";

import { firstPreviewUrl } from "./linkPreviewPolicy";

test("only HTTPS URLs are eligible for automatic previews", () => {
  assert.equal(firstPreviewUrl("read https://example.com/a."), "https://example.com/a");
  assert.equal(firstPreviewUrl("http://example.com"), null);
  assert.equal(firstPreviewUrl("javascript:alert(1)"), null);
});
