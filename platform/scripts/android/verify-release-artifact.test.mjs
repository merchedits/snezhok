import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments, parseArchitectures, parseCertificateDigest, resolveCertificateDigest, validateCertificateDigest, validatePublicationManifest } from "./verify-release-artifact.mjs";

test("parses release verifier arguments", () => {
  assert.deepEqual(parseArguments(["--apk", "release.apk", "--version-code", "42"]), { apk: "release.apk", "version-code": "42" });
  assert.throws(() => parseArguments(["--apk"]), /missing value/);
});

test("extracts unique sorted APK architectures", () => {
  assert.deepEqual(parseArchitectures("/lib/x86_64/a.so\n/lib/arm64-v8a/b.so\n/lib/arm64-v8a/c.so"), ["arm64-v8a", "x86_64"]);
});

test("normalizes the signing certificate SHA-256 digest", () => {
  assert.equal(parseCertificateDigest("Signer #1 certificate SHA-256 digest: AA:bb:01"), "aabb01");
  assert.equal(parseCertificateDigest("no digest"), null);
});

test("falls back to the dedicated certificate report", () => {
  assert.equal(
    resolveCertificateDigest(
      "Verified using v2 scheme (APK Signature Scheme v2): true",
      "Signer #1 certificate SHA-256 digest: AB:cd:02",
    ),
    "abcd02",
  );
});

test("requires a readable certificate only when an identity is asserted", () => {
  assert.deepEqual(validateCertificateDigest(null, ""), []);
  assert.deepEqual(validateCertificateDigest(null, "aa"), ["APK signing certificate could not be read"]);
  assert.deepEqual(validateCertificateDigest("bb", "aa"), ["signing certificate is bb, expected aa"]);
  assert.deepEqual(validateCertificateDigest("aa", "aa"), []);
});

test("validates updater publication manifests", () => {
  const manifest = {
    applicationId: "xyz.merchedits.snezhok",
    version: "4.0.0",
    versionCode: 40,
    minimumVersionCode: 1,
    mandatory: false,
    bytes: 1024,
    sha256: "a".repeat(64),
    signingCertificateSha256: "b".repeat(64),
    publishedAt: "2026-07-16T12:00:00.000Z",
    sourceRevision: "c0ffee42".padEnd(40, "0"),
    releaseNotes: ["Production release"],
    architectures: ["arm64-v8a"],
    minSdk: 24,
    targetSdk: 36,
  };
  assert.deepEqual(validatePublicationManifest(manifest), []);
  assert.match(validatePublicationManifest({ ...manifest, minimumVersionCode: 41 }).join("\n"), /minimumVersionCode/);
  assert.match(validatePublicationManifest({ ...manifest, sha256: "A".repeat(64) }).join("\n"), /lowercase/);
  assert.match(validatePublicationManifest({ ...manifest, sourceRevision: "not-a-commit" }).join("\n"), /sourceRevision/);
  assert.match(validatePublicationManifest({ ...manifest, sourceRevision: manifest.sourceRevision.slice(0, 12) }).join("\n"), /complete/);
});
