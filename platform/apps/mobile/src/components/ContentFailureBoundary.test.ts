import assert from "node:assert/strict";
import test from "node:test";

import { isolatedContentComponentName } from "./contentFailureDiagnostics";

test("local failure diagnostics retain only a bounded component name", () => {
  assert.equal(isolatedContentComponentName("\n    at AuthenticatedImage (private://message/secret)"), "AuthenticatedImage");
  assert.equal(isolatedContentComponentName("private message contents"), "ContentComponent");
  assert.equal(isolatedContentComponentName(null), "ContentComponent");
});
