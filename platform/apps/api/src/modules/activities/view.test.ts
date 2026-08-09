import assert from "node:assert/strict";
import test from "node:test";
import { entryVisibleToViewer, participantDetailsArePrivate } from "./view.js";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";

test("secret paired contributions stay server-hidden until both people complete", () => {
  assert.equal(entryVisibleToViewer({ type: "question", state: "waiting", config: { secret: true } }, owner, other), false);
  assert.equal(entryVisibleToViewer({ type: "question", state: "waiting", config: { secret: true } }, owner, owner), true);
  assert.equal(entryVisibleToViewer({ type: "question", state: "completed", config: { secret: true } }, owner, other), true);
  assert.equal(entryVisibleToViewer({ type: "question", state: "waiting", config: { secret: false } }, owner, other), true);
});

test("locked memory capsules hide even the viewer's contribution until reveal", () => {
  assert.equal(entryVisibleToViewer({ type: "memory-capsule", state: "active", config: {} }, owner, owner), true);
  assert.equal(entryVisibleToViewer({ type: "memory-capsule", state: "waiting", config: {} }, owner, owner), false);
  assert.equal(entryVisibleToViewer({ type: "memory-capsule", state: "locked", config: {} }, owner, owner), false);
  assert.equal(entryVisibleToViewer({ type: "memory-capsule", state: "completed", config: {} }, owner, other), true);
});

test("living shared lists remain visible while they are edited", () => {
  assert.equal(entryVisibleToViewer({ type: "movie-list", state: "active", config: {} }, owner, other), true);
  assert.equal(entryVisibleToViewer({ type: "ideas-jar", state: "active", config: {} }, owner, other), true);
});

test("paired secrets omit peer counts and exact submission timing before reveal", () => {
  assert.equal(participantDetailsArePrivate({ type: "color-hunt", state: "active", config: {} }), true);
  assert.equal(participantDetailsArePrivate({ type: "question", state: "waiting", config: { secret: true } }), true);
  assert.equal(participantDetailsArePrivate({ type: "question", state: "waiting", config: { secret: false } }), false);
  assert.equal(participantDetailsArePrivate({ type: "blitz", state: "completed", config: {} }), false);
});
