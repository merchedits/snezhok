import assert from "node:assert/strict";
import test from "node:test";

import { isMobileOnlyPath, lockfileKeepsServerWorkspaceGraphs, packageManifestDiffIsVerifierOnly, parseArguments } from "./verify-mobile-only-revision.mjs";

test("mobile-only release arguments require explicit values", () => {
  assert.deepEqual(parseArguments(["--base", "a", "--revision", "b"]), { base: "a", revision: "b" });
  assert.throws(() => parseArguments(["--base", "--revision"]), /usage/);
});

test("mobile-only releases cannot include API, contracts, or infrastructure", () => {
  assert.equal(isMobileOnlyPath("platform/apps/mobile/src/App.tsx"), true);
  assert.equal(isMobileOnlyPath("platform/docs/MOBILE_RELEASES.md"), true);
  assert.equal(isMobileOnlyPath("platform/package-lock.json"), true);
  assert.equal(isMobileOnlyPath("platform/scripts/android/verify-mobile-only-revision.mjs"), true);
  assert.equal(isMobileOnlyPath("platform/scripts/compliance/spdx-expression.mjs"), true);
  assert.equal(isMobileOnlyPath("platform/apps/api/src/app.ts"), false);
  assert.equal(isMobileOnlyPath("platform/packages/contracts/src/index.ts"), false);
  assert.equal(isMobileOnlyPath("platform/docker-compose.production.yml"), false);
});

test("root package fast path permits only the verifier entrypoint", () => {
  const before = JSON.stringify({ scripts: { test: "node test.mjs" }, dependencies: { react: "1" } });
  const verifierOnly = JSON.stringify({ scripts: { test: "node test.mjs", "release:verify-mobile-only": "node verifier.mjs" }, dependencies: { react: "1" } });
  const dependencyChange = JSON.stringify({ scripts: { test: "node test.mjs", "release:verify-mobile-only": "node verifier.mjs" }, dependencies: { react: "2" } });
  assert.equal(packageManifestDiffIsVerifierOnly(before, verifierOnly), true);
  assert.equal(packageManifestDiffIsVerifierOnly(before, dependencyChange), false);
});

test("package lock fast path permits mobile dependencies but protects deployed workspace graphs", () => {
  const before = JSON.stringify({ lockfileVersion: 3, packages: { "": { workspaces: ["apps/*"] }, "apps/api": { dependencies: { fastify: "1" } }, "apps/mobile": { version: "1.0.0", dependencies: { react: "1" } }, "node_modules/react": { version: "1" } } });
  const mobileDependency = JSON.stringify({ lockfileVersion: 3, packages: { "": { workspaces: ["apps/*"] }, "apps/api": { dependencies: { fastify: "1" } }, "apps/mobile": { version: "1.1.0", dependencies: { react: "2", icons: "1" } }, "node_modules/react": { version: "2" }, "node_modules/icons": { version: "1" } } });
  const apiDependency = JSON.stringify({ lockfileVersion: 3, packages: { "": { workspaces: ["apps/*"] }, "apps/api": { dependencies: { fastify: "2" } }, "apps/mobile": { version: "1.1.0", dependencies: { react: "2" } } } });
  assert.equal(lockfileKeepsServerWorkspaceGraphs(before, mobileDependency), true);
  assert.equal(lockfileKeepsServerWorkspaceGraphs(before, apiDependency), false);
});
