import assert from "node:assert/strict";
import test from "node:test";
import { buildArtifacts, parseArguments } from "./generate-supply-chain-artifacts.mjs";

test("parses generation flags", () => {
  assert.deepEqual(parseArguments(["--omit-dev", "--check", "--revision", "abc1234"]), {
    omitDev: true,
    check: true,
    revision: "abc1234",
  });
});

test("deduplicates coordinates and creates a CycloneDX inventory", () => {
  const result = buildArtifacts({
    name: "example",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": { name: "example", version: "1.0.0" },
      "node_modules/a": { version: "1.2.3", license: "MIT", integrity: "sha512-YQ==", dev: true },
      "node_modules/b/node_modules/a": { version: "1.2.3", license: "MIT", integrity: "sha512-YQ==" },
    },
  }, {}, { revision: "0123456789abcdef" });
  assert.equal(result.failures.length, 0);
  assert.equal(result.inventory.packages.length, 1);
  assert.equal(result.inventory.packages[0].development, false);
  assert.equal(result.sbom.bomFormat, "CycloneDX");
  assert.equal(result.sbom.specVersion, "1.6");
  assert.equal(result.sbom.components[0].purl, "pkg:npm/a@1.2.3");
});

test("encodes scoped npm package URLs", () => {
  const result = buildArtifacts({
    lockfileVersion: 3,
    packages: { "node_modules/@scope/a": { version: "1.0.0", license: "Apache-2.0" } },
  });
  assert.equal(result.sbom.components[0].purl, "pkg:npm/%40scope/a@1.0.0");
});

test("fails closed for missing or proprietary licenses", () => {
  const result = buildArtifacts({
    lockfileVersion: 3,
    packages: {
      "node_modules/missing": { version: "1.0.0" },
      "node_modules/private": { version: "2.0.0", license: "UNLICENSED" },
    },
  });
  assert.deepEqual(result.failures, [
    "missing@1.0.0: license metadata is missing",
    "private@2.0.0: non-redistributable or unverifiable license 'UNLICENSED'",
  ]);
});

test("requires evidence for a license override", () => {
  const result = buildArtifacts({
    lockfileVersion: 3,
    packages: { "node_modules/a": { version: "1.0.0" } },
  }, { "a@1.0.0": { license: "MIT" } });
  assert.equal(result.failures.length, 3);
});

test("rejects syntactically invalid and invented SPDX metadata", () => {
  const result = buildArtifacts({
    lockfileVersion: 3,
    packages: {
      "node_modules/broken": { version: "1.0.0", license: "MIT Apache-2.0" },
      "node_modules/invented": { version: "1.0.0", license: "Free-As-In-Snow" },
    },
  });
  assert.equal(result.failures.length, 2);
  assert.match(result.failures[0], /invalid SPDX expression/);
  assert.match(result.failures[1], /unknown SPDX license identifier/);
});

test("a documented override replaces inaccurate lockfile metadata", () => {
  const result = buildArtifacts({
    lockfileVersion: 3,
    packages: { "node_modules/a": { version: "1.0.0", license: "SEE LICENSE IN LICENSE" } },
  }, {
    "a@1.0.0": {
      license: "MIT",
      source: "https://example.com/a/v1.0.0/LICENSE",
      reviewedAt: "2026-07-19",
      reason: "The tagged upstream license file supplies the missing SPDX metadata.",
    },
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.inventory.packages[0].licenseMetadataSource, "reviewed-override");
});
