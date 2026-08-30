import assert from "node:assert/strict";
import test from "node:test";

import { isPublicAddress, parsePreviewHtml, parsePreviewUrl } from "./safePreview.js";

test("link previews reject non-HTTPS, credentials, custom ports and private address families", () => {
  for (const value of ["http://example.com", "https://user:pass@example.com", "https://example.com:8443", "https://127.0.0.1", "https://[::1]", "https://169.254.169.254"]) assert.throws(() => parsePreviewUrl(value));
  for (const value of ["127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.169.254", "192.168.1.1", "::1", "fc00::1", "fe80::1"]) assert.equal(isPublicAddress(value), false, value);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(parsePreviewUrl("https://example.com/path").hostname, "example.com");
});

test("link preview metadata is text-only, decoded and bounded", () => {
  const preview = parsePreviewHtml('<html><head><title>Fallback</title><meta property="og:title" content="Hello &amp; goodbye"><meta name="description" content="A useful page"></head></html>');
  assert.equal(preview.title, "Hello & goodbye");
  assert.equal(preview.description, "A useful page");
  assert.equal("image" in preview, false);
});
