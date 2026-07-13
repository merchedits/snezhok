import assert from "node:assert/strict";
import test from "node:test";

import { validEmail, validPassword, validUsername } from "./authValidation";

test("auth fields mirror the public API constraints", () => {
  assert.equal(validUsername("snow.friend"), true);
  assert.equal(validUsername("снежок"), false);
  assert.equal(validUsername("two words"), false);
  assert.equal(validEmail("friend@example.com"), true);
  assert.equal(validEmail("friend@example"), false);
  assert.equal(validPassword("12345678"), true);
  assert.equal(validPassword("1234567"), false);
});
