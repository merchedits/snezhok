import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("packages the Android instrumentation runner explicitly", () => {
  const gradle = readFileSync(new URL("../../apps/mobile/performance/messaging-e2e/messaging-e2e.gradle", import.meta.url), "utf8");
  assert.match(gradle, /implementation 'androidx\.test:runner:[^']+'/);
});

test("declares package visibility for the separately installed Snezhok app", () => {
  const manifest = readFileSync(new URL("../../apps/mobile/performance/messaging-e2e/AndroidManifest.xml", import.meta.url), "utf8");
  assert.match(manifest, /<queries>[\s\S]*<package android:name="xyz\.merchedits\.snezhok"\s*\/>[\s\S]*<\/queries>/);
});

test("uses React Native raw testID resource names for UIAutomator selectors", () => {
  const source = readFileSync(new URL("../../apps/mobile/performance/messaging-e2e/MessagingSmokeTests.kt", import.meta.url), "utf8");
  assert.doesNotMatch(source, /By\.res\(PACKAGE_NAME,/);
  assert.match(source, /private fun resource\(id: String\): BySelector = By\.res\(id\)/);
});
