import assert from "node:assert/strict";
import test from "node:test";
import { participantMayEditEntry, participantMaySubmit, selectionAfterEntryChange } from "./policy.js";

test("paired contributions are final after submission", () => {
  assert.equal(participantMaySubmit("active"), true);
  assert.equal(participantMaySubmit("invited"), true);
  assert.equal(participantMaySubmit("submitted"), false);
  assert.equal(participantMaySubmit("completed"), false);
  assert.equal(participantMaySubmit("declined"), false);
});

test("only an entry creator can edit or remove shared-list content", () => {
  assert.equal(participantMayEditEntry("owner", "owner", "remove-item"), true);
  assert.equal(participantMayEditEntry("owner", "peer", "remove-item"), false);
  assert.equal(participantMayEditEntry("owner", "peer", "update-item"), false);
  assert.equal(participantMayEditEntry("owner", "peer", "rate"), true);
  assert.equal(participantMayEditEntry("owner", "peer", "set-status"), true);
});

test("a removed or unavailable item cannot remain the shared random pick", () => {
  assert.deepEqual(selectionAfterEntryChange({ selectedEntryId: "item", pickedAt: 123, other: true }, "item", true), { other: true });
  assert.deepEqual(selectionAfterEntryChange({ selectedEntryId: "other", pickedAt: 123 }, "item", true), { selectedEntryId: "other", pickedAt: 123 });
  assert.deepEqual(selectionAfterEntryChange(null, "item", true), {});
});
