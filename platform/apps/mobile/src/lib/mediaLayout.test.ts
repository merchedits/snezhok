import assert from "node:assert/strict";
import test from "node:test";

import { messageMediaSize } from "./mediaLayout";

test("message media reserves the server-provided aspect ratio", () => {
  assert.deepEqual(messageMediaSize(1600, 1200), { width: 250, height: 188 });
});

test("message media bounds extreme and missing dimensions", () => {
  assert.deepEqual(messageMediaSize(400, 1600), { width: 80, height: 320 });
  assert.deepEqual(messageMediaSize(1080, 1920), { width: 180, height: 320 });
  assert.deepEqual(messageMediaSize(4000, 400), { width: 250, height: 25 });
  assert.deepEqual(messageMediaSize(null, null), { width: 250, height: 190 });
});
