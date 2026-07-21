import assert from "node:assert/strict";
import test from "node:test";
import { isSpdxLicenseId, parseSpdxExpression } from "./spdx-expression.mjs";

test("accepts reviewed SPDX identifiers and compound expressions", () => {
  for (const expression of [
    "MIT",
    "(MIT OR Apache-2.0)",
    "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
    "GPL-2.0-only WITH Classpath-exception-2.0",
    "LicenseRef-Vendor-Commercial-Exception",
  ]) assert.doesNotThrow(() => parseSpdxExpression(expression));
  assert.equal(isSpdxLicenseId("Apache-2.0"), true);
  assert.equal(isSpdxLicenseId("MIT OR Apache-2.0"), false);
});

test("rejects malformed and invented SPDX expressions", () => {
  for (const expression of [
    "MIT Apache-2.0",
    "MIT AND",
    "(MIT OR Apache-2.0",
    "Totally-Free",
    "(MIT) WITH Classpath-exception-2.0",
    "MIT WITH Imaginary-exception",
  ]) assert.throws(() => parseSpdxExpression(expression));
});
