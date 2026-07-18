import assert from "node:assert/strict";
import test from "node:test";

import { validUploadCapability } from "./routes.js";

test("upload capability accepts only one canonical 256-bit base64url secret", () => {
  const valid = "A".repeat(42) + "_";
  assert.equal(validUploadCapability(valid), valid);
  assert.equal(validUploadCapability([valid, "ignored"]), valid);
  assert.equal(validUploadCapability("short"), null);
  assert.equal(validUploadCapability("A".repeat(42) + "+"), null);
  assert.equal(validUploadCapability("A".repeat(44)), null);
  assert.equal(validUploadCapability(undefined), null);
});
