import assert from "node:assert/strict";
import test from "node:test";

import { parseAdbDevices, parsePackageVersion, sanitizeEvidence, selectDevice } from "./run-messaging-e2e.mjs";

test("parses and selects one authorized Android device", () => {
  const devices = parseAdbDevices("List of devices attached\nserial-1 device product:a model:SM_A125F\noffline-1 offline\n\n");
  assert.equal(selectDevice(devices), "serial-1");
  assert.throws(() => selectDevice([], undefined), /found 0/);
});

test("redacts credentials and private identifiers from E2E evidence", () => {
  const sanitized = sanitizeEvidence("Bearer abc.def user@example.com ?token=private 123e4567-e89b-42d3-a456-426614174000");
  assert.equal(sanitized, "Bearer [redacted] [redacted-email] ?token=[redacted] [redacted-id]");
});

test("extracts installed package version without retaining dumpsys output", () => {
  assert.deepEqual(parsePackageVersion("versionCode=44 minSdk=24 targetSdk=36\nversionName=4.5.2"), { versionName: "4.5.2", versionCode: 44 });
});
