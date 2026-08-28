import assert from "node:assert/strict";
import test from "node:test";
import { shouldRenderCameraTrack } from "./callVideoPresentation";

test("disabled or muted cameras cannot leave a frozen video surface", () => {
  assert.equal(shouldRenderCameraTrack(true, false), true);
  assert.equal(shouldRenderCameraTrack(false, false), false);
  assert.equal(shouldRenderCameraTrack(true, true), false);
});
