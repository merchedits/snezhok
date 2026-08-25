import assert from "node:assert/strict";
import test from "node:test";

import { clampImageTranslation, doubleTapImageTranslation, imagePanBounds } from "./imageViewerMath";

test("zoomed contained images can pan all the way to every real edge", () => {
  assert.deepEqual(imagePanBounds(360, 720, 1080, 1920, 3), { x: 360, y: 600 });
  assert.deepEqual(imagePanBounds(360, 720, 1920, 1080, 3), { x: 360, y: 0 });
  assert.equal(clampImageTranslation(-900, 360), -360);
  assert.equal(clampImageTranslation(900, 360), 360);
});

test("double tap keeps the tapped corner reachable without under-scaling translation", () => {
  const bounds = imagePanBounds(360, 720, 1080, 1920, 2.5);
  assert.equal(doubleTapImageTranslation(360, 0, 2.5, bounds.x), 270);
  assert.equal(doubleTapImageTranslation(720, 0, 2.5, bounds.y), 440);
});
