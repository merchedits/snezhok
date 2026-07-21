import assert from "node:assert/strict";
import test from "node:test";

import { acknowledgePendingSettings, hasPendingSettings, mergePendingSettings } from "./pendingSettings";

test("offline settings patches merge with last-write-wins semantics", () => {
  const pending = mergePendingSettings(
    { language: "ru", reducedMotion: false },
    { language: "en", density: "compact" },
  );
  assert.deepEqual(pending, { language: "en", reducedMotion: false, density: "compact" });
  assert.equal(hasPendingSettings(pending), true);
});

test("an acknowledgement never removes a newer local value", () => {
  const current = { language: "ru" as const, reducedMotion: true };
  const remaining = acknowledgePendingSettings(current, { language: "en", reducedMotion: true });
  assert.deepEqual(remaining, { language: "ru" });
  assert.equal(hasPendingSettings(acknowledgePendingSettings(remaining, { language: "ru" })), false);
});
