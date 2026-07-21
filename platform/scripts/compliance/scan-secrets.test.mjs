import assert from "node:assert/strict";
import test from "node:test";
import { scanText } from "./scan-secrets.mjs";

test("detects high-confidence credentials without returning their value", () => {
  const value = `prefix ghp_${"a".repeat(36)} suffix`;
  assert.deepEqual(scanText(value), [{ rule: "github-token", line: 1 }]);
  assert.equal(JSON.stringify(scanText(value)).includes("ghp_"), false);
});

test("ignores templated connection strings and CI placeholders", () => {
  assert.deepEqual(scanText("postgresql://user:${PASSWORD}@postgres/db"), []);
  assert.deepEqual(scanText("postgresql://user:ci-only-password@postgres/db"), []);
});

test("reports only the matching line number", () => {
  const value = `safe\nAIza${"a".repeat(35)}\nsafe`;
  assert.deepEqual(scanText(value), [{ rule: "google-api-key", line: 2 }]);
});
