import assert from "node:assert/strict";
import test from "node:test";
import { migrationChecksum } from "./migrate.js";

test("migration checksums are stable and detect historical edits", () => {
  const original = migrationChecksum("CREATE TABLE example(id uuid PRIMARY KEY);\n");
  assert.equal(original, migrationChecksum("CREATE TABLE example(id uuid PRIMARY KEY);\n"));
  assert.notEqual(original, migrationChecksum("CREATE TABLE example(id uuid PRIMARY KEY, name text);\n"));
  assert.match(original, /^[0-9a-f]{64}$/);
});
