import assert from "node:assert/strict";
import test from "node:test";

import { densityValue, safeBubbleRadius, scaledFont } from "./uiPreferences";

test("visual preferences clamp corrupt cached values", () => {
  assert.equal(scaledFont(16, 2), 24);
  assert.equal(scaledFont(16, Number.NaN), 16);
  assert.equal(safeBubbleRadius(99), 24);
  assert.equal(safeBubbleRadius(Number.NaN), 16);
});

test("density selects component-specific compact metrics", () => {
  assert.equal(densityValue("compact", 72, 62), 62);
  assert.equal(densityValue("comfortable", 72, 62), 72);
});
