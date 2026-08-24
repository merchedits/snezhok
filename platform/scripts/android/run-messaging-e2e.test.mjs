import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isMarkerCommitted, isMarkerVisible, mediaStoreIdForFilename, mediaStoreIdsForFilename, parseAdbDevices, parsePackageVersion, sanitizeEvidence, selectDevice } from "./run-messaging-e2e.mjs";

const runnerSource = readFileSync(new URL("./run-messaging-e2e.mjs", import.meta.url), "utf8");

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
  assert.match(source, /tapBackdropAbove\(sheet\)/);
  assert.match(source, /am force-stop \$PACKAGE_NAME/);
});

test("installs the gallery fixture through MediaStore and continues collecting independent failures", () => {
  const fixtureSource = readFileSync(new URL("../../apps/mobile/performance/messaging-e2e/FixtureActivity.kt", import.meta.url), "utf8");
  const pluginSource = readFileSync(new URL("../../apps/mobile/plugins/withAndroidMessagingE2E.cjs", import.meta.url), "utf8");
  assert.match(fixtureSource, /MediaStore\.Images\.Media\.DATE_TAKEN/);
  assert.match(fixtureSource, /R\.raw\.snezhok_e2e_photo/);
  assert.match(pluginSource, /snezhok_e2e_photo\.png/);
  assert.doesNotMatch(runnerSource, /suiteFailure = failure;[\s\S]{0,120}\bbreak;/);
});

test("detects a marker only beneath a committed message without retaining chat content", () => {
  const marker = "snezhok-e2e-1720000000000";
  const committed = `<hierarchy><node resource-id="message_committed"><node text="${marker}" resource-id="" /></node></hierarchy>`;
  const pending = `<hierarchy><node resource-id="message_pending"><node text="${marker}" resource-id="" /></node></hierarchy>`;
  assert.equal(isMarkerCommitted(committed, marker), true);
  assert.equal(isMarkerCommitted(pending, marker), false);
  assert.equal(isMarkerCommitted(committed, "another-marker"), false);
  assert.equal(isMarkerVisible(pending, marker), true);
  assert.equal(isMarkerVisible(pending, "another-marker"), false);
});

test("finds the exact private-safe fixture row in MediaStore output", () => {
  const rows = "Row: 0 _id=41, _display_name=other.png\nRow: 1 _id=42, _display_name=snezhok-e2e-photo.png\n";
  assert.equal(mediaStoreIdForFilename(rows, "snezhok-e2e-photo.png"), "42");
  assert.equal(mediaStoreIdForFilename(rows, "photo.png"), null);
  assert.deepEqual(mediaStoreIdsForFilename(`${rows}Row: 2 _id=43, _display_name=snezhok-e2e-photo.png\n`, "snezhok-e2e-photo.png"), ["42", "43"]);
});
