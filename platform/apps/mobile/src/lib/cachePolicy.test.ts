import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCachedMessages } from "./cachePolicy";

test("legacy cached messages are made safe without touching session state", () => {
  const normalized = normalizeCachedMessages({
    stream: [{ id: "message", streamId: "stream", sequence: 1, createdAt: 1, sender: { id: "user" }, text: "old cache" }],
  });
  assert.equal(normalized.stream?.length, 1);
  assert.deepEqual(normalized.stream?.[0]?.attachments, []);
  assert.deepEqual(normalized.stream?.[0]?.reactions, []);
});

test("invalid cached records are discarded instead of reaching chat rendering", () => {
  assert.deepEqual(normalizeCachedMessages({ stream: [{ id: "missing-fields" }, null] }), { stream: [] });
  assert.deepEqual(normalizeCachedMessages(null), {});
});
