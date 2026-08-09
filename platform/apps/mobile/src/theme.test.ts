import assert from "node:assert/strict";
import test from "node:test";

import { brand, createPalette, radii, spacing } from "./theme";

test("the product uses the fixed Snezhok brand system", () => {
  const light = createPalette("light");
  assert.equal(light.background, brand.milk);
  assert.equal(light.text, brand.ink);
  assert.equal(light.accent, brand.violet);
  assert.equal(light.pop, brand.lime);
  assert.equal(light.navigation, brand.violet);
  assert.equal(light.chatCanvas, brand.milk);
});

test("geometry follows the brand rhythm instead of ad-hoc screen values", () => {
  assert.equal(spacing.page, 20);
  assert.equal(spacing.section, 24);
  assert.equal(radii.control, 12);
  assert.equal(radii.card, 18);
  assert.equal(radii.hero, 24);
  assert.equal(radii.dock, 26);
});

test("functional color pairs retain readable text contrast", () => {
  for (const scheme of ["light", "dark"] as const) {
    const palette = createPalette(scheme);
    assert.ok(contrast(palette.text, palette.background) >= 4.5);
    assert.ok(contrast(palette.text, palette.incoming) >= 4.5);
    assert.ok(contrast(palette.onAccent, palette.outgoing) >= 4.5);
    assert.ok(contrast(palette.onAccent, palette.accent) >= 4.5);
    assert.ok(contrast(palette.onPop, palette.pop) >= 4.5);
    assert.ok(contrast(palette.onDanger, palette.danger) >= 4.5);
  }
});

function contrast(first: string, second: string) {
  const bright = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (bright + 0.05) / (dark + 0.05);
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
