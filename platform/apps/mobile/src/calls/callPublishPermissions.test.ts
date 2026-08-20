import assert from "node:assert/strict";
import test from "node:test";

import { mayPublishSource } from "./callPublishPermissions";

test("call publication accepts protocol and SDK source representations", () => {
  assert.equal(mayPublishSource({ canPublish: true, canPublishSources: [2] }, "microphone"), true);
  assert.equal(mayPublishSource({ canPublish: true, canPublishSources: ["camera"] }, "camera"), true);
  assert.equal(mayPublishSource({ canPublish: true, canPublishSources: [1] }, "microphone"), false);
});

test("missing permission snapshots defer to server enforcement without hiding the microphone", () => {
  assert.equal(mayPublishSource(undefined, "microphone"), true);
  assert.equal(mayPublishSource({ canPublish: true, canPublishSources: [] }, "microphone"), true);
  assert.equal(mayPublishSource({ canPublish: false, canPublishSources: [] }, "microphone"), false);
});
