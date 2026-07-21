import assert from "node:assert/strict";
import test from "node:test";
import { parseAndroidReleaseManifest, parseSingleRange } from "./routes.js";

test("Android APK downloads accept resumable byte ranges", () => {
  assert.deepEqual(parseSingleRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseSingleRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseSingleRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(parseSingleRange("bytes=100-", 100), "invalid");
  assert.equal(parseSingleRange("bytes=1-2,4-5", 100), "invalid");
});

test("Android release manifests preserve complete provenance and consistent policy", () => {
  const release = {
    applicationId: "xyz.merchedits.snezhok",
    version: "3.8.1",
    versionCode: 26,
    minimumVersionCode: 1,
    mandatory: false,
    bytes: 1024,
    sha256: "a".repeat(64),
    signingCertificateSha256: "b".repeat(64),
    publishedAt: "2026-07-22T00:00:00Z",
    sourceRevision: "c".repeat(40),
    architectures: ["arm64-v8a", "armeabi-v7a"],
    minSdk: 24,
    targetSdk: 36,
    releaseNotes: ["Verified release"],
  } as const;
  assert.deepEqual(parseAndroidReleaseManifest(release), release);
  assert.throws(() => parseAndroidReleaseManifest({ ...release, sourceRevision: "c0ffee" }));
  assert.throws(() => parseAndroidReleaseManifest({ ...release, minimumVersionCode: 27 }));
  assert.throws(() => parseAndroidReleaseManifest({ ...release, targetSdk: 23 }));
});
