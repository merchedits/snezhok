import assert from "node:assert/strict";
import test from "node:test";
import { validateMessageAttachmentKinds, validateMessageAttachmentShape } from "./service.js";

test("message kinds enforce attachment count and media type invariants", () => {
  assert.doesNotThrow(() => validateMessageAttachmentShape("voice", 1));
  assert.throws(() => validateMessageAttachmentShape("voice", 0));
  assert.throws(() => validateMessageAttachmentShape("video-note", 2));
  assert.throws(() => validateMessageAttachmentShape("media", 0));
  assert.throws(() => validateMessageAttachmentShape("file", 0));
  assert.throws(() => validateMessageAttachmentShape("text", 1));
  assert.doesNotThrow(() => validateMessageAttachmentKinds("media", ["image", "video"]));
  assert.throws(() => validateMessageAttachmentKinds("media", ["document"]));
  assert.throws(() => validateMessageAttachmentKinds("voice", ["video"]));
});
