import assert from "node:assert/strict";
import test from "node:test";

import { createPalette } from "./theme";

test("the product palette has one fixed accent and saturated screen canvases", () => {
  const light = createPalette("light");
  assert.equal(light.accent, "#3858E8");
  assert.notEqual(light.background, light.chatCanvas);
  assert.notEqual(light.chatCanvas, light.profileCanvas);
  assert.notEqual(light.profileCanvas, light.settingsCanvas);
  assert.equal(light.elevated, "#FFF8E7");
});

test("dark mode remains colorful instead of collapsing to charcoal", () => {
  const dark = createPalette("dark");
  assert.equal(dark.background, "#1B1D52");
  assert.equal(dark.chatCanvas, "#22265F");
  assert.equal(dark.accent, "#7FA2FF");
  assert.notEqual(dark.surface, "#222731");
});

test("fixed play colors and message bubbles retain readable text contrast", () => {
  for (const scheme of ["light", "dark"] as const) {
    const palette = createPalette(scheme);
    for (const fill of Object.values(palette.moment)) assert.ok(contrast(palette.text, fill) >= 4.5, `${scheme} ${fill} must retain AA text contrast`);
    assert.ok(contrast(palette.text, palette.incoming) >= 4.5);
    assert.ok(contrast(palette.text, palette.outgoing) >= 4.5);
    assert.ok(contrast(palette.onAccent, palette.accent) >= 4.5);
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
