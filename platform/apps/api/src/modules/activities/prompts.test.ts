import assert from "node:assert/strict";
import test from "node:test";
import { questionPool } from "./prompts.js";

test("random questions exclude romantic and adult packs without mutual consent", () => {
  assert.equal(questionPool("random", false).length, 15);
  assert.equal(questionPool("random", true).length, 21);
  assert.equal(questionPool("romantic", false).length, 3, "the service applies the explicit-category consent gate before prompt selection");
});
