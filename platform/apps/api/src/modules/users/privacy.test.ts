import assert from "node:assert/strict";
import test from "node:test";
import { audienceAllows } from "./privacy.js";

test("privacy audiences are fail-closed for contacts and nobody", () => {
  assert.equal(audienceAllows("everyone", false), true);
  assert.equal(audienceAllows("contacts", true), true);
  assert.equal(audienceAllows("contacts", false), false);
  assert.equal(audienceAllows("nobody", true), false);
});
