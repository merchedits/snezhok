import assert from "node:assert/strict";
import test from "node:test";

import { uploadPercent } from "./uploadProgress";

test("upload progress is a bounded whole-number percentage", () => {
  assert.equal(uploadPercent(0, 100), 0);
  assert.equal(uploadPercent(51, 100), 51);
  assert.equal(uploadPercent(10, 3), 100);
  assert.equal(uploadPercent(-1, 100), 0);
});

test("upload progress tolerates an unavailable native total", () => {
  assert.equal(uploadPercent(20, 0), 0);
  assert.equal(uploadPercent(Number.NaN, 100), 0);
});
