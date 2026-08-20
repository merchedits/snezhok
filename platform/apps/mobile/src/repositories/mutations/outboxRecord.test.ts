import assert from "node:assert/strict";
import test from "node:test";

import { decodeOutboxRecords } from "./outboxRecord";

test("persisted mutation records fail closed per record and retain valid work", () => {
  const valid = {
    kind: "message", id: crypto.randomUUID(), streamId: crypto.randomUUID(), queuedAt: 1, attempts: 0,
    input: { clientId: crypto.randomUUID(), text: "hello", kind: "text", replyToId: null, attachmentIds: [], silent: false },
  };
  const decoded = decodeOutboxRecords([valid, { ...valid, id: "corrupt", input: { ...valid.input, text: "private text must not enter a diagnostic" } }]);
  assert.equal(decoded.entries.length, 1);
  assert.equal(decoded.rejected, 1);
  assert.equal(decoded.entries[0]?.id, valid.id);
});

test("legacy message records acquire their explicit durable kind", () => {
  const legacy = {
    id: crypto.randomUUID(), streamId: crypto.randomUUID(), queuedAt: 1, attempts: 0,
    input: { clientId: crypto.randomUUID(), text: "legacy", kind: "text", replyToId: null, attachmentIds: [], silent: false },
  };
  const decoded = decodeOutboxRecords([legacy]);
  assert.equal(decoded.entries[0]?.kind, "message");
});
