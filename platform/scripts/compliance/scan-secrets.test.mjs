import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readTrackedFile, scanText } from "./scan-secrets.mjs";

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

test("an index-only deleted path is absent from the working-tree scan", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "snezhok-secret-scan-"));
  try {
    assert.equal(await readTrackedFile(root, "deleted.ts"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
