import assert from "node:assert/strict";
import test from "node:test";

import { resolveMediaUrl } from "../lib/mediaUrl";

test("local optimistic media sources are not rewritten as server paths", () => {
  assert.equal(resolveMediaUrl("file:///private/photo.jpg", "https://example.test/api/v1"), "file:///private/photo.jpg");
  assert.equal(resolveMediaUrl("content://media/external/1", "https://example.test/api/v1"), "content://media/external/1");
});
