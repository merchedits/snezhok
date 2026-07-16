import assert from "node:assert/strict";
import test from "node:test";
import { planReleaseRetention } from "./prune-releases.mjs";

test("keeps the newest releases and the currently published release", () => {
  const day = 86_400_000;
  const now = 100 * day;
  const entries = [1, 2, 3, 4, 5].map((versionCode) => ({
    version: `1.0.${versionCode}`,
    versionCode,
    modifiedAt: now - 60 * day,
  }));
  const removals = planReleaseRetention(entries, { keep: 2, minimumAgeDays: 30, now, currentVersion: "1.0.1" });
  assert.deepEqual(removals.map((entry) => entry.version), ["1.0.3", "1.0.2"]);
});

test("never removes a recent release", () => {
  const day = 86_400_000;
  const entries = [1, 2, 3].map((versionCode) => ({ version: `2.0.${versionCode}`, versionCode, modifiedAt: 50 * day }));
  assert.deepEqual(planReleaseRetention(entries, { keep: 2, minimumAgeDays: 30, now: 60 * day }), []);
});

test("rejects unsafe retention values", () => {
  assert.throws(() => planReleaseRetention([], { keep: 1 }), /at least 2/);
  assert.throws(() => planReleaseRetention([], { minimumAgeDays: 0 }), /positive/);
});
