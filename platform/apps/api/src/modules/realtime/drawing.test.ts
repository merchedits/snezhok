import assert from "node:assert/strict";
import test from "node:test";

import { validLiveDrawing } from "./socket.js";

test("live drawing validation accepts bounded canvas strokes", () => {
  assert.equal(validLiveDrawing([[[0, 0], [150, 120], [300, 240]]]), true);
});

test("live drawing validation rejects oversized and invalid coordinates", () => {
  assert.equal(validLiveDrawing([[[0, 0], [301, 20]]]), false);
  assert.equal(validLiveDrawing([[[0, 0], [20, 241]]]), false);
  assert.equal(validLiveDrawing([[[0, 0]]]), false);
  assert.equal(validLiveDrawing(Array.from({ length: 201 }, () => [[0, 0], [1, 1]])), false);
});
