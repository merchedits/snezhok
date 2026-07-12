import assert from "node:assert/strict";
import test from "node:test";
import { objectPath } from "./storage.js";

test("object storage rejects path traversal segments", () => {
  assert.throws(() => objectPath("objects/../secret"), /Unsafe storage key/);
  assert.match(objectPath("objects/ab/abcdef"), /objects[\\/]ab[\\/]abcdef$/);
});
