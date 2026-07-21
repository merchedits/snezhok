import assert from "node:assert/strict";
import test from "node:test";
import { validateAndroidEvidence } from "./validate-android-evidence.mjs";

function fixture() {
  const hash = "a".repeat(64);
  const component = {
    group: "com.example",
    name: "library",
    version: "1.2.3",
    coordinate: "com.example:library:1.2.3",
    purl: "pkg:maven/com.example/library@1.2.3",
    license: "Apache-2.0",
    licenseMetadataSource: "pom",
    declaredPomLicenses: [{ name: "Apache License, Version 2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" }],
    artifacts: [{ name: "library-1.2.3.aar", bytes: 42, sha256: "b".repeat(64) }],
    embeddedLegalTexts: [{ artifact: "library-1.2.3.aar", path: "META-INF/LICENSE", sha256: hash }],
    dependsOn: [],
  };
  return {
    inventory: { schemaVersion: 1, configuration: "releaseRuntimeClasspath", sourceRevision: "abc1234", componentCount: 1, legalTextCount: 1, unresolvedLicenseCount: 0, components: [component] },
    cdx: { bomFormat: "CycloneDX", specVersion: "1.6", components: [{ purl: component.purl }], dependencies: [{ ref: component.purl, dependsOn: [] }] },
    notices: component.coordinate,
    files: new Map([[`texts/${hash}.txt`, "fixture legal text"]]),
  };
}

test("validates complete resolved Android dependency evidence", () => {
  const value = fixture();
  const digest = "a".repeat(64);
  value.inventory.components[0].embeddedLegalTexts[0].sha256 = digest;
  value.files = new Set([`texts/${digest}.txt`]);
  assert.deepEqual(validateAndroidEvidence(value.inventory, value.cdx, value.notices, value.files, "abc1234"), []);
});

test("fails closed on unknown licenses and missing packaged texts", () => {
  const value = fixture();
  value.inventory.components[0].license = "Very-Permissive";
  value.files.clear();
  const failures = validateAndroidEvidence(value.inventory, value.cdx, value.notices, value.files, "def5678");
  assert.equal(failures.length, 3);
  assert.match(failures.join("\n"), /sourceRevision/);
  assert.match(failures.join("\n"), /unknown SPDX/);
  assert.match(failures.join("\n"), /is not packaged/);
});

test("verifies packaged legal text content against its digest", () => {
  const value = fixture();
  const failures = validateAndroidEvidence(value.inventory, value.cdx, value.notices, value.files, "abc1234");
  assert.equal(failures.length, 1);
  assert.match(failures[0], /does not match its digest/);
});
