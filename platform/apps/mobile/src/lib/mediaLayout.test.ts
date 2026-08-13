import assert from "node:assert/strict";
import test from "node:test";

import { messageMediaSize } from "./mediaLayout";

test("message media reserves the server-provided aspect ratio", () => {
  assert.deepEqual(messageMediaSize(1600, 1200), { width: 286, height: 215 });
  assert.deepEqual(messageMediaSize(1920, 2560), { width: 286, height: 381 });
});

test("message media bounds extreme and missing dimensions", () => {
  assert.deepEqual(messageMediaSize(400, 1600), { width: 105, height: 420 });
  assert.deepEqual(messageMediaSize(1080, 1920), { width: 236, height: 420 });
  assert.deepEqual(messageMediaSize(4000, 400), { width: 286, height: 29 });
  assert.deepEqual(messageMediaSize(null, null), { width: 276, height: 207 });
});
